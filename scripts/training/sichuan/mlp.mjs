import { readFileSync } from 'node:fs';

export function loadPolicy(path, createPolicy) {
  const model = JSON.parse(readFileSync(path, 'utf8'));
  return createPolicy(model);
}

export function distribution(logits, mask) {
  const legal = [...mask.keys()].filter(index => mask[index]);
  const maximum = Math.max(...legal.map(index => logits[index]));
  const masses = legal.map(index => Math.exp(logits[index] - maximum));
  const total = masses.reduce((sum, mass) => sum + mass, 0);
  return { legal, probabilities: masses.map(mass => mass / total) };
}

export function selectAction(policy, features, mask, random, greedy) {
  const result = policy(features);
  const { legal, probabilities } = distribution(result.logits, mask);
  let action = legal[0];
  if (greedy) action = legal.reduce((best, index) => result.logits[index] > result.logits[best] ? index : best, action);
  else {
    let target = random();
    for (let index = 0; index < legal.length; index++) {
      target -= probabilities[index];
      action = legal[index];
      if (target <= 0) break;
    }
  }
  return { action, logProb: Math.log(Math.max(1e-30, probabilities[legal.indexOf(action)])), value: result.value };
}
