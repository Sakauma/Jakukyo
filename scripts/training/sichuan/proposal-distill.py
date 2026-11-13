"""Distill public-state search proposals; select by held-out, game-mean regret."""
import argparse
import base64
import hashlib
import importlib.util
import json
import math
import os
import sys
import time
from collections import Counter
from pathlib import Path

os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True

import numpy as np
import torch
from torch.nn import functional as F

FEATURES, ACTIONS, SEED = 476, 137, 20261113
TEACHER_SPEC = {"version": 1, "trials": 16, "depth": 2,
                "nodesPerExecutedGroup": 128000, "maximumExecutedGroups": 4}
TRAIN_PREFIX, VAL_PREFIX = "sichuan-distill-train-", "sichuan-distill-val-"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def close(left, right):
    return math.isclose(left, right, rel_tol=1e-9, abs_tol=1e-8)


def file_sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def strict_json(line):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    def constant(value):
        raise ValueError(f"Nonfinite JSON constant: {value}")

    return json.loads(line, object_pairs_hook=pairs, parse_constant=constant)


def raw_field(line, field):
    """Retain JS float/string serialization when hashing the public snapshot."""
    decoder, position = json.JSONDecoder(), 0
    while position < len(line) and line[position].isspace():
        position += 1
    require(position < len(line) and line[position] == "{", "Expected JSON object")
    position += 1
    while position < len(line):
        while line[position].isspace() or line[position] == ",":
            position += 1
        if line[position] == "}":
            break
        key, position = decoder.raw_decode(line, position)
        while line[position].isspace():
            position += 1
        require(line[position] == ":", "Expected JSON field separator")
        position += 1
        while line[position].isspace():
            position += 1
        start = position
        _, position = decoder.raw_decode(line, position)
        if key == field:
            return line[start:position]
    raise ValueError(f"Missing JSON field: {field}")


def configure(root):
    spec = importlib.util.spec_from_file_location("sichuan_training", Path(__file__).with_name("train.py"))
    training = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(training)
    training.ROOT, training.FEATURES, training.FEATURE_VERSION, training.SEED = Path(root), FEATURES, 3, SEED
    if os.environ.get("JAKUKYO_TRAIN_DEVICE") == "cpu":
        training.DEVICE = "cpu"
        training.DEVICE_REPORT["device"] = "cpu"
    torch.set_num_threads(int(os.environ.get("JAKUKYO_TORCH_THREADS", "4")))
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    training.random.seed(SEED)
    return training


def model_sha(model):
    digest = hashlib.sha256()
    for layer in (model.layers[0], model.layers[2], model.layers[4]):
        for parameter in (layer.weight, layer.bias):
            digest.update(parameter.detach().cpu().numpy().astype("<f4").tobytes())
    return digest.hexdigest()


def load_model(training, path):
    checkpoint = torch.load(path, map_location=training.DEVICE, weights_only=False)
    require(checkpoint.get("featureVersion") == 3, "Checkpoint must use featureVersion 3")
    require(checkpoint.get("architecture") == [FEATURES, 128, 128, 138], "Checkpoint architecture mismatch")
    model = training.ActorCritic().to(training.DEVICE)
    model.load_state_dict(checkpoint["model"])
    require(all(torch.isfinite(parameter).all().item() for parameter in model.parameters()), "Nonfinite checkpoint")
    return model, checkpoint


def decode_features(value):
    require(isinstance(value, str), "Features must be base64 float32")
    features = np.frombuffer(base64.b64decode(value, validate=True), dtype="<f4")
    require(features.shape == (FEATURES,) and np.isfinite(features).all(), "Invalid feature vector")
    require(np.isin(features[472:], [0, 1]).all(), "Invalid public hasWon features")
    return features.copy()


def legal_mask(mask, proposal=False):
    require(isinstance(mask, list) and len(mask) > (1 if proposal else 0), "Empty or forced proposal mask")
    require(all(integer(index, 2 if proposal else 0, 28 if proposal else ACTIONS - 1) for index in mask), "Invalid mask index")
    require(len(set(mask)) == len(mask), "Duplicate mask index")
    result = np.zeros(ACTIONS, dtype=np.bool_)
    result[mask] = True
    return result


def within(root, path):
    resolved = Path(path).resolve()
    require(resolved.is_relative_to(Path(root).resolve()), f"Path must be within --run-dir: {resolved}")
    return resolved


def public_audit(row, line, features):
    snapshot = row["publicInput"]
    require(isinstance(snapshot, dict), "Missing public input")
    require(set(snapshot) <= set("aiVersion difficulty drawn rulesVersion exchangeThree sichuan wildcard profile furiten player actions observation".split()), "Unexpected private input field")
    require(set(snapshot["player"]) <= set("hand melds flowers voidSuit riichi doubleRiichi ippatsu kita floatCount".split()), "Unexpected own-player field")
    observation = snapshot["observation"]
    require(set(observation) <= set("ownId seat roundWind roundHand finalRound playerCount activePlayerCount ownHand doraIndicators additionalPublicTiles tilesLeft honba riichiSticks allowOpenTanyao discardFuriten tileLimits wildcards pointScale expectedDealInValue dealerValueMultiplier seed players".split()), "Unexpected private observation field")
    require(isinstance(observation.get("seed"), str) and observation["seed"].startswith("public:"), "Teacher has a private game seed")
    require(observation.get("playerCount") == 4 and len(observation["players"]) == 4, "Expected four public players")
    require(observation.get("ownId") == row["candidateSeat"], "Candidate seat differs from public actor")
    players = observation["players"]
    allowed = set("id seat points dealer riichi active hasWon voidSuit expectedDealInValue melds discards".split())
    for player in players:
        require(set(player) <= allowed and type(player.get("hasWon")) is bool, "Invalid public player whitelist")
    require({player["seat"] for player in players} == {0, 1, 2, 3}, "Invalid public seats")
    relative = sorted(players, key=lambda player: (player["seat"] - observation["seat"] + 4) % 4)
    require(features[472:].tolist() == [int(player["hasWon"]) for player in relative], "hasWon differs from decision-time public snapshot")
    require(hashlib.sha256(raw_field(line, "publicInput").encode("utf8")).hexdigest() == row["publicStateHash"], "Public snapshot digest mismatch")
    legal = {}
    for action in snapshot["actions"]:
        require(set(action) <= set("key type tile tiles consume index meldIndex kind".split()), "Unexpected action field")
        tile = action.get("tile", "")
        if action.get("type") == "discard" and len(tile) == 2 and tile[0] in "mps" and tile[1] in "123456789":
            legal[action["key"]] = 2 + "mps".index(tile[0]) * 9 + int(tile[1]) - 1
    require(set(row["m"]) <= set(legal.values()), "Proposal outside public legal discards")
    for candidate in row["candidates"]:
        require(legal.get(candidate["key"]) == candidate["executed"], "Executed action differs from its public key")


def read_teacher(path, provenance, prefix, device):
    features, masks, actions, anchors, margins, deltas, executions, groups, hashes, positives = [], [], [], [], [], [], [], [], [], []
    seen, counts, configurations, buckets = set(), Counter(), Counter(), Counter()
    with Path(path).open(encoding="utf8") as stream:
        for number, line in enumerate(stream, 1):
            try:
                row = strict_json(line)
                require(row.get("schemaVersion") == 1 and row.get("supervision") == "proposal-distill", "Not proposal teacher data")
                require(row.get("featureVersion") == 3 and row.get("proposalVersion") == 1, "Old teacher feature/proposal version")
                require(row.get("teacherSpec") == TEACHER_SPEC, "Teacher specification mismatch")
                require(not set("g r v lp rawR".split()) & row.keys(), "Teacher data must not contain PPO returns")
                for key, expected in provenance.items():
                    require(row.get(key) == expected, f"Teacher {key} mismatch")
                group = row.get("splitGroup")
                require(isinstance(group, str) and group.startswith(prefix), "Teacher split namespace mismatch")
                require(integer(row.get("candidateSeat"), 0, 3), "Invalid candidate seat")
                require(isinstance(row.get("configuration"), dict), "Missing table configuration")
                require(row["configuration"].get("mode") in ("sichuan-blood", "sichuan-river"), "Not a Sichuan configuration")
                require(isinstance(row.get("collectionBehavior"), str) and row["collectionBehavior"], "Missing teacher collection behavior")
                x = decode_features(row["f"])
                mask = legal_mask(row["m"], proposal=True)
                require(integer(row.get("anchor"), 2, 28) and row["anchor"] in row["m"], "Illegal anchor")
                require(integer(row.get("target"), 2, 28) and row["target"] in row["m"], "Illegal target")
                candidates = row["candidates"]
                require(isinstance(candidates, list) and len(candidates) == len(row["m"]), "Candidate/mask count mismatch")
                require({item.get("proposal") for item in candidates} == set(row["m"]), "Candidate/mask mismatch")
                base = next(item for item in candidates if item["proposal"] == row["anchor"])
                require(base.get("executed") == row["anchor"] and finite(base.get("qRef")), "Anchor must execute itself")
                target, margin, by_execution = row["anchor"], 0.0, {}
                delta_row, execution_row = np.zeros(ACTIONS, dtype=np.float64), np.full(ACTIONS, -1, dtype=np.int64)
                for candidate in candidates:
                    proposal, executed = candidate["proposal"], candidate["executed"]
                    require(integer(executed, 2, 28) and executed in row["m"], "Illegal executed action")
                    require(candidate.get("teacherComplete") is True and type(candidate.get("runtimeComplete")) is bool, "Incomplete teacher evaluation")
                    require(candidate["runtimeComplete"] or executed == row["anchor"], "Incomplete runtime must fall back to anchor")
                    require(finite(candidate.get("runtimeNodes")) and candidate["runtimeNodes"] >= 0, "Invalid runtime nodes")
                    require(integer(candidate.get("teacherNodes"), 0, TEACHER_SPEC["nodesPerExecutedGroup"]), "Invalid teacher nodes")
                    require(finite(candidate.get("qRef")) and finite(candidate.get("delta")), "Nonfinite teacher label")
                    require(close(candidate["delta"], candidate["qRef"] - base["qRef"]), "Teacher delta does not match qRef")
                    if executed == row["anchor"]:
                        require(candidate["delta"] == 0, "Anchor alias must have zero delta")
                    signature = (candidate["qRef"], candidate["delta"], candidate["teacherNodes"], candidate["key"])
                    require(executed not in by_execution or by_execution[executed] == signature, "Equivalent executions have different teacher labels")
                    by_execution[executed] = signature
                    delta_row[proposal], execution_row[proposal] = candidate["delta"], executed
                    if candidate["delta"] > margin + 1e-9:
                        target, margin = proposal, candidate["delta"]
                require(len(by_execution) <= TEACHER_SPEC["maximumExecutedGroups"] and row.get("groups") == len(by_execution), "Invalid executed-group count")
                require(row.get("nodes") == sum(item[2] for item in by_execution.values()), "Teacher node total mismatch")
                require(row["target"] == target and finite(row.get("margin")) and close(row["margin"], margin), "Teacher target/margin mismatch")
                public_audit(row, line, x)
                identity = (group, row["publicStateHash"])
                require(identity not in seen, "Repeated teacher state within game")
                seen.add(identity)
                features.append(x); masks.append(mask); actions.append(target); anchors.append(row["anchor"])
                margins.append(margin); deltas.append(delta_row); executions.append(execution_row)
                best_delta = max(item["delta"] for item in candidates)
                positives.append(mask & (delta_row >= best_delta - 1e-9))
                groups.append(group); hashes.append(row["publicStateHash"]); counts[group] += 1
                configurations[row["configuration"].get("id", row["configuration"]["mode"])] += 1
                buckets[str(row.get("bucket"))] += 1
            except (ValueError, KeyError, TypeError, StopIteration, IndexError) as error:
                raise ValueError(f"{Path(path).name}:{number}: {error}") from error
    require(features, "No teacher samples")
    n = len(features)
    informative = np.array([bool(np.any(mask & ~positive)) for mask, positive in zip(masks, positives)])
    effective_counts = Counter(group for group, useful in zip(groups, informative) if useful)
    effective_n = int(informative.sum())
    weights = np.array([effective_n / (len(effective_counts) * effective_counts[group]) if useful else 0
                        for group, useful in zip(groups, informative)], dtype=np.float32)
    data = {"x": np.stack(features), "mask": np.stack(masks), "positiveMask": np.stack(positives),
            "a": np.array(actions, dtype=np.int64), "weight": weights, "informative": informative}
    tensors = {key: torch.from_numpy(value).to(device) for key, value in data.items()}
    info = {"samples": n, "games": len(counts), "informativeSamples": effective_n, "informativeGames": len(effective_counts),
            "nonAnchorSamples": int(np.sum(np.array(actions) != anchors)),
            "sha256": file_sha(path), "prefix": prefix, "configurations": dict(configurations), "buckets": dict(buckets)}
    return tensors | {"groups": groups, "stateHashes": hashes, "anchors": np.array(anchors), "margins": np.array(margins),
                      "deltas": np.stack(deltas), "executions": np.stack(executions), "audit": info}


def group_average(values, groups):
    sums, counts = {}, Counter(groups)
    for group, value in zip(groups, values):
        sums[group] = sums.get(group, 0.0) + float(value)
    return sum(sums[group] / counts[group] for group in counts) / len(counts) if counts else None


def proposal_ce(training, logits, masks, positives):
    """Every proposal mapped to an equally best executed action is a valid target."""
    return torch.logsumexp(training.masked(logits, masks), dim=1) - torch.logsumexp(training.masked(logits, positives), dim=1)


@torch.no_grad()
def evaluate(training, model, data):
    predictions, losses = [], []
    for start in range(0, len(data["a"]), 1024):
        sl = slice(start, start + 1024)
        logits, _ = model(data["x"][sl])
        logits = training.masked(logits, data["mask"][sl])
        predictions.append(logits.argmax(1).cpu().numpy())
        losses.append(F.cross_entropy(logits, data["a"][sl], reduction="none").cpu().numpy())
    predicted, ce = np.concatenate(predictions), np.concatenate(losses)
    targets = data["a"].cpu().numpy()
    regret = data["margins"] - data["deltas"][np.arange(len(targets)), predicted]
    accurate = predicted == targets
    optimal = data["positiveMask"].cpu().numpy()[np.arange(len(targets)), predicted]
    executed_accurate = data["executions"][np.arange(len(targets)), predicted] == data["executions"][np.arange(len(targets)), targets]
    result = {}
    for name, selection in (("overall", np.ones(len(targets), dtype=np.bool_)), ("anchor", targets == data["anchors"]), ("nonAnchor", targets != data["anchors"])):
        groups = [group for group, keep in zip(data["groups"], selection) if keep]
        result[name] = {"samples": int(selection.sum()), "games": len(set(groups)),
                        "labelAccuracy": float(accurate[selection].mean()) if groups else None,
                        "gameMeanLabelAccuracy": group_average(accurate[selection], groups),
                        "executionAccuracy": float(executed_accurate[selection].mean()) if groups else None,
                        "optimalExecutionAccuracy": float(optimal[selection].mean()) if groups else None,
                        "teacherRegret": float(regret[selection].mean()) if groups else None,
                        "gameMeanTeacherRegret": group_average(regret[selection], groups),
                        "crossEntropy": float(ce[selection].mean()) if groups else None}
    result["predictedNonAnchor"] = int(np.sum(predicted != data["anchors"]))
    return result


def save_enriched(training, path, model, optimizer, step, history, phase, metadata):
    training.save_checkpoint(path, model, optimizer, step, history, phase)
    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    checkpoint.update(metadata)
    torch.save(checkpoint, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("run-dir", "data", "validation", "init", "output", "engine", "baseline-engine"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--learning-rate", type=float, default=.0003)
    parser.add_argument("--audit-only", action="store_true")
    args = parser.parse_args()
    require(1 <= args.epochs <= 30 and args.batch > 0 and finite(args.learning_rate) and args.learning_rate > 0, "Invalid training limits")
    root = Path(args.run_dir).resolve()
    for key in ("data", "validation", "init", "output", "engine", "baseline_engine"):
        setattr(args, key, within(root, getattr(args, key)))
    require(args.data != args.validation, "Train and validation files must differ")
    training = configure(root)
    model, _ = load_model(training, args.init)
    warm_sha = model_sha(model)
    provenance = {"parametersSha256": warm_sha, "engineSha256": file_sha(args.engine), "baselineEngineSha256": file_sha(args.baseline_engine)}
    train = read_teacher(args.data, provenance, TRAIN_PREFIX, training.DEVICE)
    validation = read_teacher(args.validation, provenance, VAL_PREFIX, training.DEVICE)
    require(train["audit"]["informativeSamples"] > 0, "No informative teacher execution groups")
    require(not set(train["groups"]) & set(validation["groups"]), "Full-game seed leakage across splits")
    require(not set(train["stateHashes"]) & set(validation["stateHashes"]), "Public state leakage across splits")
    audit = {"train": train["audit"], "validation": validation["audit"], "independentFullGameSeeds": True, "provenance": provenance}
    if args.audit_only:
        print(json.dumps({"auditOnly": True, **audit}), flush=True)
        return
    args.output.mkdir(parents=True, exist_ok=True)
    destination = args.output / "best.pt"
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=.0001)
    critic_weight, critic_bias = model.layers[4].weight[137].detach().clone(), model.layers[4].bias[137].detach().clone()
    warm_metrics = {"train": evaluate(training, model, train), "validation": evaluate(training, model, validation)}
    best, selected_epoch, steps = warm_metrics["validation"]["overall"]["gameMeanTeacherRegret"], 0, 0
    metadata = {"schemaVersion": 1, "collectionParametersSha256": warm_sha, "teacherEngineSha256": provenance["engineSha256"],
                "baselineEngineSha256": provenance["baselineEngineSha256"], "trainingDataSha256": train["audit"]["sha256"],
                "validationDataSha256": validation["audit"]["sha256"], "trainSplitPrefix": TRAIN_PREFIX, "validationSplitPrefix": VAL_PREFIX,
                "teacherSpec": TEACHER_SPEC, "selection": "validation-game-mean-teacher-regret", "selectedEpoch": 0,
                "selectedValidationTeacherRegret": best, "warmValidationTeacherRegret": best,
                "criticTeacherSupervision": False, "objective": "best-executed-group-cross-entropy"}
    history = [{"epoch": 0, "validation": warm_metrics["validation"]}]
    save_enriched(training, destination, model, optimizer, steps, history, "proposal-distill", {"proposalDistill": metadata})
    began = time.time()
    informative_indices = torch.where(train["informative"])[0]
    for epoch in range(1, args.epochs + 1):
        total_loss = 0.0
        permutation = informative_indices[torch.randperm(len(informative_indices), device=training.DEVICE)]
        for indices in permutation.split(args.batch):
            logits, _ = model(train["x"][indices])
            loss = (proposal_ce(training, logits, train["mask"][indices], train["positiveMask"][indices]) * train["weight"][indices]).mean()
            require(torch.isfinite(loss).item(), "Nonfinite distillation loss")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            optimizer.step()
            # AdamW decay would otherwise alter the unused critic row despite its zero gradient.
            with torch.no_grad():
                model.layers[4].weight[137].copy_(critic_weight)
                model.layers[4].bias[137].copy_(critic_bias)
            total_loss += loss.item() * len(indices)
            steps += 1
        metrics = evaluate(training, model, validation)
        result = {"epoch": epoch, "trainGroupedPolicyCE": total_loss / len(informative_indices), "validation": metrics}
        history.append(result)
        regret = metrics["overall"]["gameMeanTeacherRegret"]
        if regret < best - 1e-12:
            best, selected_epoch = regret, epoch
            metadata.update(selectedEpoch=epoch, selectedValidationTeacherRegret=best)
            save_enriched(training, destination, model, optimizer, steps, history, "proposal-distill", {"proposalDistill": metadata})
        print(json.dumps(result | {"selectedEpoch": selected_epoch}), flush=True)
    chosen, checkpoint = load_model(training, destination)
    require(torch.equal(chosen.layers[4].weight[137], critic_weight) and torch.equal(chosen.layers[4].bias[137], critic_bias), "Distillation altered critic head parameters")
    chosen_metrics = {"train": evaluate(training, chosen, train), "validation": evaluate(training, chosen, validation)}
    digest = training.export_model(chosen, args.output / "best.json", destination.name)
    require(digest == model_sha(chosen), "Export parameter digest mismatch")
    report = {"phase": "proposal-distill", "featureVersion": 3, "proposalVersion": 1, "features": FEATURES,
              "teacherSpec": TEACHER_SPEC, "audit": audit, "warm": warm_metrics, "chosen": chosen_metrics,
              "selection": "validation-game-mean-teacher-regret; epoch 0 included; earliest wins ties", "selectedEpoch": selected_epoch,
              "epochs": args.epochs, "batch": args.batch, "steps": steps, "selectedSteps": checkpoint["step"], "learningRate": args.learning_rate,
              "gameBalancedCrossEntropy": True, "objective": "best-executed-group-cross-entropy", "allTiedRowsExcludedFromLossDenominator": True,
              "criticTeacherSupervision": False, "criticHeadUnchanged": True,
              "sharedTrunkTrained": True, "criticOutputCanChangeWithTrunk": True, "history": history,
              "warmParametersSha256": warm_sha, "parametersSha256": digest, "device": training.DEVICE_REPORT, "seconds": time.time() - began}
    (args.output / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf8")
    print(json.dumps({"complete": True, "selectedEpoch": selected_epoch, "parametersSha256": digest,
                      "warmValidationTeacherRegret": warm_metrics["validation"]["overall"]["gameMeanTeacherRegret"],
                      "chosenValidationTeacherRegret": best, "report": str(args.output / "report.json")}), flush=True)


if __name__ == "__main__":
    main()
