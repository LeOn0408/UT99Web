export function readClasses(pkg) {
  const byIndex = new Map(pkg.exports.map((item) => [item.index, item]));
  const classes = new Map();

  const nameOf = (ref) => {
    if (ref > 0) return byIndex.get(ref - 1)?.objectName ?? null;
    if (ref < 0) return pkg.imports[-ref - 1]?.objectName ?? null;
    return null;
  };

  for (const item of pkg.exports) {
    if (item.classIndex !== 0) continue;
    classes.set(item.objectName, {
      name: item.objectName,
      index: item.index,
      superName: nameOf(item.superIndex),
      superIndex: item.superIndex,
      children: []
    });
  }

  for (const info of classes.values()) {
    if (!info.superName) continue;
    classes.get(info.superName)?.children.push(info.name);
  }

  return classes;
}

export function classAncestry(classes, name) {
  const chain = [];
  let current = classes.get(name);
  let guard = 0;
  while (current && guard < 128) {
    chain.push(current.name);
    if (!current.superName) break;
    const parent = classes.get(current.superName);
    if (!parent) {
      chain.push(current.superName);
      break;
    }
    current = parent;
    guard += 1;
  }
  return chain;
}

export function findClasses(classes, pattern) {
  const expression = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  return [...classes.keys()].filter((name) => expression.test(name)).sort();
}
