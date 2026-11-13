"""Audited on-policy PPO over the proposal used by the deployed search mapping."""
import argparse
import importlib.util
import json
import os
import sys
from collections import Counter
from pathlib import Path

os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

spec = importlib.util.spec_from_file_location("proposal_distill", Path(__file__).with_name("proposal-distill.py"))
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
require, finite, integer, close = common.require, common.finite, common.integer, common.close


def read_rollout(path, provenance, expected_hands, seed_prefix, device):
    arrays = {key: [] for key in ("x", "mask", "a", "g", "lp", "v")}
    seeds, seen, configurations, seats = [], set(), Counter(), Counter()
    forced, changed, total_records = 0, 0, 0
    with Path(path).open(encoding="utf8") as stream:
        for number, line in enumerate(stream, 1):
            try:
                episode = common.strict_json(line)
                require(episode.get("featureVersion") == 3 and episode.get("rewardVersion") == 3 and episode.get("proposalVersion") == 1, "Old feature/reward/proposal version")
                require(episode.get("mode") == "proposal" and episode.get("behavior") == "categorical", "PPO requires categorical proposal behavior")
                require(episode.get("opponents") == "formal-ai8" and episode.get("opponentAiVersion") == 8, "Expected three formal AI8 opponents")
                for key, expected in provenance.items():
                    require(episode.get(key) == expected, f"Episode {key} mismatch")
                seed = episode.get("seed")
                require(isinstance(seed, str) and seed.startswith(seed_prefix), "Rollout seed namespace mismatch")
                require(seed not in seen, "Repeated rollout game seed")
                seen.add(seed); seeds.append(seed)
                seat = episode.get("candidateSeat")
                require(integer(seat, 0, 3), "Expected exactly one candidate seat")
                seats[seat] += 1
                configuration = episode.get("configuration")
                require(isinstance(configuration, dict) and configuration.get("mode") in ("sichuan-blood", "sichuan-river"), "Invalid Sichuan configuration")
                configurations[configuration.get("id", configuration["mode"])] += 1
                require(episode.get("kind") in ("win", "draw"), "Incomplete episode: missing terminal settlement")
                require(integer(episode.get("ticks"), 1, 1800), "Incomplete episode: invalid tick count")
                initial, final, trajectories = episode["initial"], episode["final"], episode["trajectories"]
                require(len(initial) == len(final) == len(trajectories) == 4, "Expected four-seat episode")
                require(all(finite(value) for value in initial + final), "Nonfinite episode points")
                require(close(sum(initial), sum(final)), "Non-zero-sum terminal points")
                for key in ("deltas", "preDecision"):
                    require(isinstance(episode.get(key), list) and len(episode[key]) == 4 and all(finite(value) for value in episode[key]), f"Invalid {key} ledger")
                require(all(close(episode["deltas"][index], final[index] - initial[index]) for index in range(4)), "Terminal delta mismatch")
                ledger_net = [0.0] * 4
                require(isinstance(episode.get("ledger"), list), "Missing transfer ledger")
                for transfer in episode["ledger"]:
                    source, target, amount = transfer["from"], transfer["to"], transfer["amount"]
                    require(integer(source, 0, 3) and integer(target, 0, 3) and source != target and finite(amount) and amount >= 0, "Invalid transfer")
                    ledger_net[source] -= amount; ledger_net[target] += amount
                require(all(close(ledger_net[index], final[index] - initial[index]) for index in range(4)), "Transfer ledger differs from final score")
                for player, trajectory in enumerate(trajectories):
                    require(isinstance(trajectory, list), "Invalid trajectory")
                    first_points = trajectory[0].get("p") if trajectory else final[player]
                    require(finite(first_points) and close(episode["preDecision"][player], first_points - initial[player]), "Pre-decision ledger mismatch")
                    previous_step, return_sum = -1, 0.0
                    for at, record in enumerate(trajectory):
                        total_records += 1
                        require(type(record.get("policy")) is bool, "Missing policy flag")
                        require(record.get("proposalVersion") == 1 and record.get("rewardVersion") == 3, "Old record proposal/reward version")
                        for key in ("engineSha256", "parametersSha256"):
                            require(record.get(key) == provenance[key], f"Record {key} mismatch")
                        require(not {"qRef", "delta"} & record.keys(), "Teacher labels cannot be PPO returns")
                        require(integer(record.get("step"), 0, 100000) and record["step"] >= previous_step, "Invalid trajectory step order")
                        previous_step = record["step"]
                        require(isinstance(record.get("key"), str) and isinstance(record.get("type"), str), "Missing executed action")
                        for key in ("g", "r", "rawR", "p", "lp", "v"):
                            require(finite(record.get(key)), f"Nonfinite or missing {key}")
                        features = common.decode_features(record["f"])
                        mask = common.legal_mask(record["m"], proposal=record["policy"])
                        action, proposed, executed = record.get("a"), record.get("proposedAction"), record.get("executedAction")
                        require(integer(action, 0, 136) and mask[action], "Illegal sampled proposal")
                        require(integer(proposed, 0, 136) and action == proposed, "Sampled action differs from proposedAction")
                        require(integer(executed, 0, 136), "Invalid executedAction")
                        following_points = trajectory[at + 1]["p"] if at + 1 < len(trajectory) else final[player]
                        require(finite(following_points), "Nonfinite next points")
                        expected_r = (following_points - record["p"]) / 32
                        require(close(record["r"], expected_r) and close(record["rawR"], expected_r), "Reward is not linear net/32")
                        require(close(record["g"], (final[player] - record["p"]) / 32), "Return is not terminal net/32")
                        return_sum += record["r"]
                        if record["policy"]:
                            require(player == seat, "Opponent trajectory marked on-policy")
                            require(record.get("behavior") == "categorical" and record["type"] == "discard", "Policy record is not a categorical discard proposal")
                            require(integer(executed, 2, 28) and executed in record["m"], "Executed proposal outside proposal mask")
                            tile = record["key"].rsplit(":", 1)[-1]
                            require(record["key"].startswith("discard:") and len(tile) == 2 and tile[0] in "mps" and tile[1] in "123456789", "Invalid executed discard key")
                            require(executed == 2 + "mps".index(tile[0]) * 9 + int(tile[1]) - 1, "Executed action differs from discard key")
                            require(record["lp"] <= 1e-6, "Positive log probability")
                            arrays["x"].append(features); arrays["mask"].append(mask); arrays["a"].append(action)
                            for key in ("g", "lp", "v"):
                                arrays[key].append(record[key])
                            changed += int(executed != action)
                        else:
                            require(record.get("behavior") == "forced", "Forced/opponent record has unexpected behavior")
                            forced += 1
                    require(close(return_sum * 32 + episode["preDecision"][player], final[player] - initial[player]), "Whole-game reward ledger mismatch")
            except (ValueError, KeyError, TypeError, IndexError) as error:
                raise ValueError(f"{Path(path).name}:{number}: {error}") from error
    require(len(seeds) == expected_hands, f"Expected {expected_hands} complete games, got {len(seeds)}")
    require(len(arrays["a"]) > 1, "Insufficient on-policy proposals")
    arrays = {key: np.asarray(value, dtype=np.bool_ if key == "mask" else np.int64 if key == "a" else np.float32) for key, value in arrays.items()}
    require(all(np.isfinite(value).all() for value in arrays.values()), "Dataset exceeds float32 range")
    data = {key: torch.from_numpy(value).to(device) for key, value in arrays.items()}
    audit = {"games": len(seeds), "samples": len(arrays["a"]), "totalRecords": total_records, "excludedForcedOrOpponentRecords": forced,
             "executedDiffersFromProposed": changed, "seeds": seeds, "seedPrefix": seed_prefix, "seatCounts": dict(seats),
             "configurations": dict(configurations), "sha256": common.file_sha(path), "provenance": provenance,
             "rewardAndTransferLedgerReconciled": True, "opponents": "three formal AI8", "allPolicyActionsEqualProposedAction": True}
    return data, audit


@torch.no_grad()
def check_parity(training, model, data):
    probability_error, value_error, value_scaled_error = 0.0, 0.0, 0.0
    for start in range(0, len(data["a"]), 1024):
        sl = slice(start, start + 1024)
        logits, values = model(data["x"][sl])
        recomputed = F.log_softmax(training.masked(logits, data["mask"][sl]), dim=1).gather(1, data["a"][sl].unsqueeze(1)).squeeze(1)
        probability_error = max(probability_error, (recomputed - data["lp"][sl]).abs().max().item())
        difference = (values - data["v"][sl]).abs()
        value_error = max(value_error, difference.max().item())
        value_scaled_error = max(value_scaled_error, (difference / (1 + data["v"][sl].abs())).max().item())
    require(probability_error <= .0002, f"Rollout old-policy log-probability mismatch: {probability_error}")
    require(value_scaled_error <= .0002, f"Rollout critic parity mismatch: {value_scaled_error}")
    return {"logProbabilityMaximumError": probability_error, "valueMaximumError": value_error, "valueMaximumScaledError": value_scaled_error,
            "logProbabilityTolerance": .0002, "valueScaledTolerance": .0002}


def bootstrap(training, root):
    checkpoint = torch.load(root / "models/best-bc.pt", map_location=training.DEVICE, weights_only=False)
    state = checkpoint["model"]
    require(state["layers.0.weight"].shape == (128, 472), "Bootstrap requires the 472-feature warm model")
    expanded = torch.zeros((128, 476), device=training.DEVICE)
    expanded[:, :472] = state["layers.0.weight"]
    state["layers.0.weight"] = expanded
    model = training.ActorCritic().to(training.DEVICE)
    model.load_state_dict(state)
    optimizer = torch.optim.AdamW(model.parameters(), lr=.00003, weight_decay=.0001)
    destination = root / "models/proposal-warm.pt"
    training.save_checkpoint(destination, model, optimizer, 0, [], "proposal-bc-warm-start")
    digest = training.export_model(model, destination.with_suffix(".json"), destination.name)
    print(json.dumps({"phase": "bootstrap", "parametersSha256": digest, "addedFeatureColumns": 4, "initialAddedWeights": 0}), flush=True)


def train(args, training):
    model, checkpoint = common.load_model(training, args.init)
    require(checkpoint.get("phase") == "proposal-distill", "PPO requires the selected proposal-distill checkpoint")
    metadata = checkpoint.get("proposalDistill")
    require(isinstance(metadata, dict) and metadata.get("schemaVersion") == 1 and metadata.get("teacherSpec") == common.TEACHER_SPEC,
            "Missing audited distillation provenance")
    require(metadata.get("selection") == "validation-game-mean-teacher-regret" and metadata.get("criticTeacherSupervision") is False, "Unapproved distillation objective")
    require(metadata.get("objective") == "best-executed-group-cross-entropy", "PPO anchors require grouped proposal labels")
    provenance = {"parametersSha256": common.model_sha(model), "engineSha256": common.file_sha(args.engine), "baselineEngineSha256": common.file_sha(args.baseline_engine)}
    require(metadata.get("teacherEngineSha256") == provenance["engineSha256"] and metadata.get("baselineEngineSha256") == provenance["baselineEngineSha256"], "Distillation and rollout engine mismatch")
    require(metadata.get("trainingDataSha256") == common.file_sha(args.anchor_data), "Anchor data differ from selected distillation data")
    anchor_provenance = {"parametersSha256": metadata["collectionParametersSha256"], "engineSha256": metadata["teacherEngineSha256"], "baselineEngineSha256": metadata["baselineEngineSha256"]}
    anchor = common.read_teacher(args.anchor_data, anchor_provenance, common.TRAIN_PREFIX, training.DEVICE)
    require(anchor["audit"]["informativeSamples"] > 0, "No informative proposal anchors")
    data, audit = read_rollout(args.data, provenance, args.expected_hands, args.seed_prefix, training.DEVICE)
    require(not set(audit["seeds"]) & set(anchor["groups"]), "On-policy and teacher full-game seeds overlap")
    parity = check_parity(training, model, data)
    compact_audit = audit | {"seeds": len(audit["seeds"])}
    if args.audit_only:
        print(json.dumps({"auditOnly": True, "rollout": compact_audit, "anchor": anchor["audit"], "parity": parity}), flush=True)
        return
    model, optimizer, checkpoint = training.load_checkpoint(args.init)
    for group in optimizer.param_groups:
        group["lr"] = .00003
    advantage = data["g"] - data["v"]
    advantage = (advantage - advantage.mean()) / (advantage.std(unbiased=False) + 1e-8)
    history, steps = [], 0
    informative_anchors = torch.where(anchor["informative"])[0]
    initial = torch.cat([parameter.detach().flatten() for parameter in model.parameters()]).clone()
    for epoch in range(args.epochs):
        losses = []
        for indices in torch.randperm(len(data["a"]), device=training.DEVICE).split(512):
            logits, values = model(data["x"][indices])
            log_probs = F.log_softmax(training.masked(logits, data["mask"][indices]), dim=1)
            selected = log_probs.gather(1, data["a"][indices].unsqueeze(1)).squeeze(1)
            ratio = (selected - data["lp"][indices]).exp()
            surrogate = torch.minimum(ratio * advantage[indices], ratio.clamp(.8, 1.2) * advantage[indices])
            entropy = -(log_probs.exp() * log_probs).sum(1).mean()
            value_loss = F.smooth_l1_loss(values, data["g"][indices], beta=1.0)
            anchors = informative_anchors[torch.randint(len(informative_anchors), (len(indices),), device=training.DEVICE)]
            anchor_logits, _ = model(anchor["x"][anchors])
            anchor_ce = (common.proposal_ce(training, anchor_logits, anchor["mask"][anchors], anchor["positiveMask"][anchors]) * anchor["weight"][anchors]).mean()
            loss = -surrogate.mean() + .5 * value_loss - .005 * entropy + .02 * anchor_ce
            require(torch.isfinite(loss).item(), "Nonfinite PPO loss")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), .5, error_if_nonfinite=True)
            optimizer.step()
            steps += 1
            losses.append({"loss": loss.item(), "valueHuber": value_loss.item(), "entropy": entropy.item(), "proposalAnchorGroupedCE": anchor_ce.item(),
                           "approximateKL": (data["lp"][indices] - selected).mean().item(), "clipFraction": ((ratio - 1).abs() > .2).float().mean().item()})
        result = {"epoch": epoch + 1, **{key: sum(loss[key] for loss in losses) / len(losses) for key in losses[0]}}
        history.append(result)
        print(json.dumps(result), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    ppo_metadata = {"schemaVersion": 1, "behavior": "categorical", "featureVersion": 3, "rewardVersion": 3, "proposalVersion": 1,
                    "initParametersSha256": provenance["parametersSha256"], "dataSha256": audit["sha256"], "engineSha256": provenance["engineSha256"],
                    "baselineEngineSha256": provenance["baselineEngineSha256"], "seedPrefix": args.seed_prefix, "games": args.expected_hands,
                    "anchorCoefficient": .02, "anchorDataSha256": anchor["audit"]["sha256"]}
    common.save_enriched(training, args.output, model, optimizer, checkpoint["step"] + steps, history, "proposal-distill-ppo-linear",
                         {"proposalDistill": metadata, "proposalPpo": ppo_metadata})
    digest = training.export_model(model, args.output.with_suffix(".json"), args.output.name)
    restored, _, _ = training.load_checkpoint(args.output)
    restored_exact = all(torch.equal(left, right) for left, right in zip(model.parameters(), restored.parameters()))
    require(restored_exact and digest == common.model_sha(restored), "Proposal checkpoint restore/export mismatch")
    report = {"phase": "proposal-distill-ppo-linear", "featureVersion": 3, "features": 476, "proposalVersion": 1,
              "rewardVersion": 3, "return": "(finalPoints - pointsBeforeDecision)/32", "gamma": 1, "audit": audit,
              "anchorAudit": anchor["audit"], "anchorCollectionProvenance": anchor_provenance,
              "epochs": args.epochs, "batch": 512, "steps": steps, "priorSteps": checkpoint["step"],
              "proposal": "categorical proposal followed by fixed search; executed action may differ from sampled proposal",
              "learningRate": .00003, "clip": .2, "valueHuberBeta": 1, "gradientNorm": .5, "valueCoefficient": .5,
              "entropyCoefficient": .005, "proposalAnchorCoefficient": .02, "anchorObjective": "best-executed-group-cross-entropy",
              "allTiedAnchorRowsExcludedFromLossDenominator": True, "oldBCSupervision": False, "teacherCriticSupervision": False,
              "parity": parity, "checkpointRestoreExact": restored_exact,
              "parameterL2Change": torch.norm(torch.cat([parameter.detach().flatten() for parameter in model.parameters()]) - initial).item(),
              "history": history, "parametersSha256": digest, "initParametersSha256": provenance["parametersSha256"], "device": training.DEVICE_REPORT}
    args.output.with_suffix(".report.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf8")
    print(json.dumps({"complete": True, "parametersSha256": digest, "games": audit["games"], "samples": audit["samples"],
                      "parameterL2Change": report["parameterL2Change"], "report": str(args.output.with_suffix('.report.json'))}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["bootstrap", "train"])
    parser.add_argument("--run-dir", required=True)
    for name in ("init", "data", "anchor-data", "output", "engine", "baseline-engine"):
        parser.add_argument("--" + name)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--expected-hands", type=int, default=800)
    parser.add_argument("--seed-prefix", default="sichuan-distill-ppo-")
    parser.add_argument("--audit-only", action="store_true")
    args = parser.parse_args()
    root = Path(args.run_dir).resolve()
    training = common.configure(root)
    if args.phase == "bootstrap":
        require(not args.audit_only, "bootstrap has no audit-only phase")
        bootstrap(training, root)
        return
    require(1 <= args.epochs <= 4 and args.expected_hands > 0, "PPO requires 1..4 epochs and positive game count")
    require(args.seed_prefix.startswith("sichuan-distill-ppo-"), "Use the fresh distillation PPO namespace")
    for key in ("init", "data", "anchor_data", "output", "engine", "baseline_engine"):
        require(getattr(args, key), f"train requires --{key.replace('_', '-')}")
        setattr(args, key, common.within(root, getattr(args, key)))
    require(args.output != args.init, "Do not overwrite the selected distilled checkpoint")
    train(args, training)


if __name__ == "__main__":
    main()
