export const groupBy = <T, K extends keyof any>(list: T[], getKey: (item: T) => K): Map<K, T[]> => {
  return list.reduce((map, item) => {
    const key = getKey(item);
    const collection = map.get(key);
    if (!collection) {
      map.set(key, [item]);
    } else {
      collection.push(item);
    }
    return map;
  }, new Map<K, T[]>());
};
