import { readActorProperties } from "./lights.mjs";

function resolveObject(pkg, index) {
  if (!index) return null;
  if (index < 0) {
    const item = pkg.imports[-index - 1];
    return item ? { className: item.className, objectName: item.objectName } : null;
  }
  const item = pkg.exports[index - 1];
  return item ? { className: item.className, objectName: item.objectName } : null;
}

export function readLevelInfo(pkg) {
  const item = pkg.exports.find((entry) => entry.className === "LevelInfo");
  if (!item) return { title: null, author: null, song: null };
  try {
    const { properties } = readActorProperties(pkg, item);
    const songRef = properties.get("Song")?.value;
    const song = resolveObject(pkg, songRef);
    return {
      title: properties.get("Title")?.value ?? null,
      author: properties.get("Author")?.value ?? null,
      song: song?.className === "Music" ? song.objectName : song?.objectName ?? null
    };
  } catch {
    return { title: null, author: null, song: null };
  }
}
