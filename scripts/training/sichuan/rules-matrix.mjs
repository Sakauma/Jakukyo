export const configurations = ['sichuan-blood', 'sichuan-river'].flatMap(mode =>
  [false, true].flatMap(exchangeThree => [3, 4, 5, 6, 8, 'none'].flatMap(fanCap =>
    ['base', 'fan'].flatMap(selfDraw => [false, true].map(menqingZhongzhang => ({
      id: `${mode}-x${Number(exchangeThree)}-c${fanCap}-${selfDraw}-m${Number(menqingZhongzhang)}`,
      mode, exchangeThree, sichuan: { version: 2, fanCap, selfDraw, menqingZhongzhang },
      cohort: `${mode}-x${Number(exchangeThree)}-${fanCap === 'none' ? 'uncapped' : 'capped'}`,
    }))))));

/** Each seed identifies one complete wall and table configuration. */
export function makePlan(namespace, perConfiguration = 1) {
  return configurations.flatMap(configuration => Array.from({ length: perConfiguration }, (_, index) => ({
    seed: `${namespace}/${configuration.id}/${String(index).padStart(5, '0')}`, configuration,
  })));
}

/** Equal representation of the eight flow/exchange/cap strata. */
export function makeBalancedPlan(namespace, perCohort) {
  const cohorts = [...new Set(configurations.map(configuration => configuration.cohort))];
  return cohorts.flatMap(cohort => {
    const choices = configurations.filter(configuration => configuration.cohort === cohort);
    return Array.from({ length: perCohort }, (_, index) => {
      const configuration = choices[index % choices.length];
      return { seed: `${namespace}/${configuration.id}/${String(Math.floor(index / choices.length)).padStart(5, '0')}`, configuration };
    });
  });
}
