"""Small public-information actor/critic, behavior cloning and clipped PPO."""
import argparse
import base64
import hashlib
import json
import os
import random
import time
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Train the public-information Sichuan actor/critic in an explicit output directory.")
    parser.add_argument("phase", choices=["bc", "ppo"])
    parser.add_argument("--run-dir", required=True, help="Directory containing data, models and reports")
    parser.add_argument("--epochs", type=int, help="Additional training epochs, default 60 for BC and 4 for PPO")
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--resume", help="Restore model, optimizer and CPU/CUDA/random generator states for either phase")
    parser.add_argument("--warm-start", help="Initialize BC weights from a compatible earlier feature version with a fresh optimizer")
    parser.add_argument("--feature-version", type=int, choices=[1, 2], default=1)
    parser.add_argument("--seed", type=int, default=20261112)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--data", help="PPO self-play JSONL file")
    parser.add_argument("--output", help="PPO checkpoint destination")
    parsed = parser.parse_args()
    parsed.epochs = parsed.epochs if parsed.epochs is not None else 60 if parsed.phase == "bc" else 4
    if parsed.epochs <= 0 or parsed.batch <= 0:
        parser.error("epochs and batch must be positive integers")
    if parsed.phase == "ppo" and not all([parsed.resume, parsed.data, parsed.output]):
        parser.error("ppo requires --resume, --data and --output")
    return parsed


CLI_ARGS = parse_args() if __name__ == "__main__" else None
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

ROOT = Path(__file__).resolve().parent.parent
SEED = CLI_ARGS.seed if CLI_ARGS else 20261112
FEATURE_VERSION = CLI_ARGS.feature_version if CLI_ARGS else 1
FEATURES = 472 if FEATURE_VERSION == 2 else 464
torch.set_num_threads(4)
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
torch.use_deterministic_algorithms(True)
DEVICE = "cpu"
DEVICE_REPORT = {"torch": torch.__version__, "cuda_available": torch.cuda.is_available()}
if torch.cuda.is_available():
    try:
        torch.cuda.set_per_process_memory_fraction(0.10)
        torch.empty(1, device="cuda")
        DEVICE = "cuda"
        free, total = torch.cuda.mem_get_info()
        DEVICE_REPORT.update(name=torch.cuda.get_device_name(), free_bytes=free, total_bytes=total, process_fraction=0.10)
    except RuntimeError as error:
        DEVICE_REPORT["fallback"] = str(error)
DEVICE_REPORT["device"] = DEVICE


class ActorCritic(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(nn.Linear(FEATURES, 128), nn.ReLU(), nn.Linear(128, 128), nn.ReLU(), nn.Linear(128, 138))

    def forward(self, features):
        output = self.layers(features)
        return output[:, :137], output[:, 137]


def read_data(path, policy_only=False):
    seeds = []
    samples = 0
    floating = {key: False for key in ("g", "lp", "v")}
    with Path(path).open(encoding="utf8") as stream:
        for line in stream:
            episode = json.loads(line)
            seeds.append(episode["seed"])
            for trajectory in episode["trajectories"]:
                for record in trajectory:
                    if policy_only and not record["policy"]:
                        continue
                    samples += 1
                    for key in floating:
                        floating[key] |= isinstance(record[key], float)
    if not samples:
        raise ValueError("Dataset contains no selected decisions")
    arrays = {
        "x": np.empty((samples, FEATURES), dtype=np.float32),
        "mask": np.zeros((samples, 137), dtype=np.bool_),
        "a": np.empty(samples, dtype=np.int64),
        **{key: np.empty(samples, dtype=np.float32 if floating[key] else np.int64) for key in floating},
    }
    row = 0
    with Path(path).open(encoding="utf8") as stream:
        for line in stream:
            episode = json.loads(line)
            for trajectory in episode["trajectories"]:
                for record in trajectory:
                    if policy_only and not record["policy"]:
                        continue
                    if row >= samples:
                        raise ValueError("Dataset changed while it was being loaded")
                    arrays["x"][row] = np.frombuffer(base64.b64decode(record["f"]), dtype="<f4")
                    arrays["mask"][row, record["m"]] = True
                    for key in ("a", "g", "lp", "v"):
                        arrays[key][row] = record[key]
                    row += 1
    if row != samples:
        raise ValueError("Dataset changed while it was being loaded")
    result = {key: torch.from_numpy(array).to(DEVICE) for key, array in arrays.items()}
    if not result["mask"].gather(1, result["a"].unsqueeze(1)).all():
        raise ValueError("Dataset includes an illegal teacher/sample action")
    return result, seeds


def masked(logits, mask):
    return logits.masked_fill(~mask, -1e9)


@torch.no_grad()
def evaluate(model, data):
    logits, values = model(data["x"])
    logits = masked(logits, data["mask"])
    prediction = logits.argmax(1)
    nonforced = data["mask"].sum(1) > 1
    return {"cross_entropy": F.cross_entropy(logits, data["a"]).item(),
            "accuracy": (prediction == data["a"]).float().mean().item(),
            "illegal": (~data["mask"].gather(1, prediction.unsqueeze(1))).sum().item(),
            "value_mse": F.mse_loss(values, data["g"]).item(), "samples": len(prediction),
            "nonforced_samples": nonforced.sum().item(),
            "nonforced_accuracy": (prediction[nonforced] == data["a"][nonforced]).float().mean().item(),
            "nonforced_cross_entropy": F.cross_entropy(logits[nonforced], data["a"][nonforced]).item()}


def augment(features, masks, actions):
    """Exact suit symmetry, with the declared missing suit and all action groups remapped."""
    order = torch.randperm(3, device=DEVICE)
    tiles = (order.unsqueeze(1) * 9 + torch.arange(9, device=DEVICE)).flatten()
    action_order = torch.cat([torch.arange(2, device=DEVICE)] + [tiles + offset for offset in (2, 29, 56, 83, 110)])
    transformed = features.clone()
    transformed[:, :432] = features[:, :432].reshape(-1, 27, 16)[:, tiles].reshape(-1, 432)
    transformed[:, 444:456] = features[:, 444:456].reshape(-1, 4, 3)[:, :, order].reshape(-1, 12)
    action_inverse = torch.argsort(action_order)
    return transformed, masks[:, action_order], action_inverse[actions]


def export_model(model, destination, checkpoint):
    layers = []
    digest = hashlib.sha256()
    for layer in (model.layers[0], model.layers[2], model.layers[4]):
        weight = layer.weight.detach().cpu().numpy().astype("<f4").tobytes()
        bias = layer.bias.detach().cpu().numpy().astype("<f4").tobytes()
        digest.update(weight)
        digest.update(bias)
        layers.append({"input": layer.in_features, "output": layer.out_features, "relu": layer.out_features != 138,
                       "weight": base64.b64encode(weight).decode(), "bias": base64.b64encode(bias).decode()})
    exported = {"format": "jakukyo-sichuan-mlp-f32-v1", "featureVersion": FEATURE_VERSION, "policyVersion": 1,
                "parametersSha256": digest.hexdigest(), "checkpoint": checkpoint, "layers": layers}
    Path(destination).write_text(json.dumps(exported, separators=(",", ":")), encoding="utf8")
    return exported["parametersSha256"]


def save_checkpoint(path, model, optimizer, step, history, phase):
    torch.save({"model": model.state_dict(), "optimizer": optimizer.state_dict(), "step": step,
                "history": history, "phase": phase, "seed": SEED, "featureVersion": FEATURE_VERSION, "architecture": [FEATURES, 128, 128, 138],
                "torch_rng": torch.get_rng_state(),
                "cuda_rng": torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [],
                "numpy_rng": np.random.get_state(),
                "python_rng": random.getstate()}, path)


def load_checkpoint(path):
    checkpoint = torch.load(path, map_location=DEVICE, weights_only=False)
    model = ActorCritic().to(DEVICE)
    model.load_state_dict(checkpoint["model"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.0001)
    optimizer.load_state_dict(checkpoint["optimizer"])
    torch.set_rng_state(checkpoint["torch_rng"].cpu())
    if checkpoint.get("cuda_rng") and torch.cuda.is_available():
        torch.cuda.set_rng_state_all([state.cpu() for state in checkpoint["cuda_rng"]])
    np.random.set_state(checkpoint["numpy_rng"])
    random.setstate(checkpoint["python_rng"])
    return model, optimizer, checkpoint


def bc_step(model, optimizer, train, indices):
    features, masks, actions = augment(train["x"][indices], train["mask"][indices], train["a"][indices])
    logits, values = model(features)
    loss = F.cross_entropy(masked(logits, masks), actions) + 0.25 * F.mse_loss(values, train["g"][indices])
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    return loss.item()


def check_training_restore(path, train, batch):
    first, optimizer, checkpoint = load_checkpoint(path)
    indices = torch.randperm(len(train["a"]), device=DEVICE)[:batch]
    first_loss = bc_step(first, optimizer, train, indices)
    save_checkpoint(ROOT / "models/resumed-bc-step.pt", first, optimizer, checkpoint["step"] + 1,
                    checkpoint["history"], "bc-resumed-step")
    second, second_optimizer, _ = load_checkpoint(path)
    repeated_indices = torch.randperm(len(train["a"]), device=DEVICE)[:batch]
    second_loss = bc_step(second, second_optimizer, train, repeated_indices)
    error = max((left - right).abs().max().item() for left, right in zip(first.parameters(), second.parameters()))
    exact = torch.equal(indices, repeated_indices) and first_loss == second_loss and error == 0
    if not exact:
        raise ValueError(f"Training continuation failed exact restore check: {error}")
    return {"exact": exact, "parameter_max_error": error, "loss": first_loss, "saved_step": checkpoint["step"] + 1}


def run_bc(args):
    train, train_seeds = read_data(ROOT / "data/sc-v2-train.jsonl")
    validation, val_seeds = read_data(ROOT / "data/sc-v2-val.jsonl")
    if set(train_seeds) & set(val_seeds):
        raise ValueError("Seed leakage across dataset partitions")
    model = ActorCritic().to(DEVICE)
    if args.warm_start:
        prior = torch.load(args.warm_start, map_location=DEVICE, weights_only=False)
        state = prior["model"]
        old_features = state["layers.0.weight"].shape[1]
        if old_features > FEATURES:
            raise ValueError("Warm-start feature dimension exceeds the new model")
        first = torch.zeros_like(model.layers[0].weight)
        first[:, :old_features] = state["layers.0.weight"]
        state["layers.0.weight"] = first
        model.load_state_dict(state)
    initial_parameters = torch.cat([parameter.detach().flatten() for parameter in model.parameters()]).clone()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.0001)
    history = [{"epoch": 0, "validation": evaluate(model, validation)}]
    steps = 0
    start_epoch = 0
    if args.resume:
        model, optimizer, prior = load_checkpoint(args.resume)
        history = prior["history"]
        steps = prior["step"]
        start_epoch = history[-1]["epoch"]
        initial_parameters = torch.cat([parameter.detach().flatten() for parameter in model.parameters()]).clone()
    baseline_validation = evaluate(model, validation)
    best = float("inf")
    if args.resume:
        best = baseline_validation["cross_entropy"]
        best_path = ROOT / "models/best-bc.pt"
        keep_existing = False
        if best_path.exists():
            with torch.random.fork_rng(devices=[torch.cuda.current_device()] if DEVICE == "cuda" else []):
                existing = torch.load(best_path, map_location=DEVICE, weights_only=False)
                existing_model = ActorCritic().to(DEVICE)
                existing_model.load_state_dict(existing["model"])
                existing_loss = evaluate(existing_model, validation)["cross_entropy"]
                keep_existing = existing_loss <= best
                best = min(best, existing_loss)
        if not keep_existing:
            save_checkpoint(best_path, model, optimizer, steps, history, "bc-resumed-start")
    started = time.time()
    for epoch in range(start_epoch + 1, start_epoch + args.epochs + 1):
        permutation = torch.randperm(len(train["a"]), device=DEVICE)
        loss_total = 0.0
        for indices in permutation.split(args.batch):
            loss = bc_step(model, optimizer, train, indices)
            steps += 1
            loss_total += loss * len(indices)
        result = {"epoch": epoch, "train_loss": loss_total / len(train["a"]), "validation": evaluate(model, validation)}
        history.append(result)
        if result["validation"]["cross_entropy"] < best:
            best = result["validation"]["cross_entropy"]
            save_checkpoint(ROOT / "models/best-bc.pt", model, optimizer, steps, history, "bc")
        if epoch % 5 == 0 or epoch == 1:
            print(json.dumps(result), flush=True)
    save_checkpoint(ROOT / "models/last-bc.pt", model, optimizer, steps, history, "bc")
    best_model, best_optimizer, checkpoint = load_checkpoint(ROOT / "models/best-bc.pt")
    before = evaluate(best_model, validation)
    save_checkpoint(ROOT / "models/restored-bc.pt", best_model, best_optimizer, checkpoint["step"], checkpoint["history"], "bc-restored")
    restored, _, _ = load_checkpoint(ROOT / "models/restored-bc.pt")
    after = evaluate(restored, validation)
    if before != after:
        raise ValueError("Checkpoint restore changed validation outputs")
    parameter_delta = torch.norm(torch.cat([parameter.detach().flatten() for parameter in model.parameters()]) - initial_parameters).item()
    digest = export_model(best_model, ROOT / "models/best-bc.json", "best-bc.pt")
    continuation = check_training_restore(ROOT / "models/best-bc.pt", train, args.batch)
    report = {"phase": "bc", "device": DEVICE_REPORT, "epochs": args.epochs, "batch": args.batch,
              "resumedFrom": args.resume, "resumedStartEpoch": start_epoch,
              "baseline_validation": baseline_validation,
              "steps": steps, "learning_rate": args.learning_rate, "weight_decay": 0.0001, "value_coefficient": 0.25,
              "feature_version": FEATURE_VERSION, "features": FEATURES, "warm_start": args.warm_start,
              "suit_augmentation": True, "seed": SEED, "train_seeds": train_seeds, "validation_seeds": val_seeds,
              "history": history, "best_validation": before, "restore_exact": before == after,
              "training_continuation": continuation,
              "best_epoch": checkpoint["history"][-1]["epoch"], "parameter_l2_change": parameter_delta,
              "parameters_sha256": digest, "seconds": time.time() - started}
    (ROOT / "bc-report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(json.dumps({"complete": report | {"history": "bc-report.json", "train_seeds": len(train_seeds), "validation_seeds": len(val_seeds)}}), flush=True)


def run_ppo(args):
    data, seeds = read_data(args.data, policy_only=True)
    teacher, _ = read_data(ROOT / "data/sc-v2-train.jsonl")
    validation, _ = read_data(ROOT / "data/sc-v2-val.jsonl")
    model, optimizer, checkpoint = load_checkpoint(args.resume)
    for group in optimizer.param_groups:
        group["lr"] = 0.00003
    with torch.no_grad():
        logits, _ = model(data["x"])
        recomputed = F.log_softmax(masked(logits, data["mask"]), dim=1).gather(1, data["a"].unsqueeze(1)).squeeze(1)
        parity = (recomputed - data["lp"]).abs().max().item()
    if parity > 0.0002:
        raise ValueError(f"Rollout policy parity failed: {parity}")
    advantage = data["g"] - data["v"]
    advantage = (advantage - advantage.mean()) / (advantage.std() + 1e-8)
    history = []
    steps = checkpoint["step"]
    for epoch in range(args.epochs):
        permutation = torch.randperm(len(data["a"]), device=DEVICE)
        losses = []
        for indices in permutation.split(args.batch):
            logits, values = model(data["x"][indices])
            logits = masked(logits, data["mask"][indices])
            log_probs = F.log_softmax(logits, dim=1)
            selected = log_probs.gather(1, data["a"][indices].unsqueeze(1)).squeeze(1)
            ratio = (selected - data["lp"][indices]).exp()
            surrogate = torch.minimum(ratio * advantage[indices], ratio.clamp(0.8, 1.2) * advantage[indices])
            entropy = -(log_probs.exp() * log_probs).sum(1).mean()
            anchors = torch.randint(len(teacher["a"]), (len(indices),), device=DEVICE)
            anchor_logits, _ = model(teacher["x"][anchors])
            anchor_loss = F.cross_entropy(masked(anchor_logits, teacher["mask"][anchors]), teacher["a"][anchors])
            value_loss = F.mse_loss(values, data["g"][indices])
            loss = -surrogate.mean() + 0.5 * value_loss - 0.005 * entropy + 0.1 * anchor_loss
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            optimizer.step()
            steps += 1
            losses.append({"loss": loss.item(), "value_loss": value_loss.item(), "entropy": entropy.item(),
                           "anchor_loss": anchor_loss.item(), "approximate_kl": (data["lp"][indices] - selected).mean().item()})
        result = {"epoch": epoch + 1, **{key: sum(item[key] for item in losses) / len(losses) for key in losses[0]}}
        history.append(result)
        print(json.dumps(result), flush=True)
    destination = Path(args.output)
    save_checkpoint(destination, model, optimizer, steps, history, "ppo-mc")
    digest = export_model(model, destination.with_suffix(".json"), destination.name)
    report = {"phase": "ppo-mc", "seeds": seeds, "samples": len(data["a"]), "epochs": args.epochs,
              "feature_version": FEATURE_VERSION, "features": FEATURES, "reward_version": 2 if FEATURE_VERSION == 2 else 1,
              "gamma": 1.0, "reward_divisor": 32, "return": "utility(finalPoints-initialPoints) - utility(pointsBeforeDecision-initialPoints)" if FEATURE_VERSION == 2 else "finalPoints[seat] - pointsBeforeDecision[seat]",
              "utility": "tanh(asinh(net/32)/4)" if FEATURE_VERSION == 2 else "net/32",
              "pre_decision_ledger": "separately reconciled to full terminal net", "episode_end": "whole hand settlement",
              "learning_rate": 0.00003, "clip": 0.2, "value_coefficient": 0.5, "entropy_coefficient": 0.005,
              "bc_anchor_coefficient": 0.1, "advantage_standardization": True,
              "rollout_logprob_max_error": parity, "history": history, "validation": evaluate(model, validation),
              "parameters_sha256": digest, "checkpoint": str(destination)}
    destination.with_suffix(".report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(json.dumps({"complete": report | {"seeds": len(seeds), "history": str(destination.with_suffix(".report.json"))}}), flush=True)


if __name__ == "__main__":
    args = CLI_ARGS
    ROOT = Path(args.run_dir).resolve()
    args.epochs = args.epochs if args.epochs is not None else 60 if args.phase == "bc" else 4
    (ROOT / "models").mkdir(exist_ok=True)
    print(json.dumps({"device": DEVICE_REPORT}), flush=True)
    if args.phase == "bc":
        run_bc(args)
    else:
        run_ppo(args)
