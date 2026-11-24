export const MAPS = {
  "DM-Deck16][": { file: "DM-Deck16][.unr.uz", title: "DM-Deck16][", mode: "Deathmatch" },
  "DM-Morpheus": { file: "DM-Morpheus.unr.uz", title: "DM-Morpheus", mode: "Deathmatch" },
  "DM-Agony": { file: "DM-Agony.unr.uz", title: "DM-Agony", mode: "Deathmatch" },
  "DM-ArcaneTemple": { file: "DM-ArcaneTemple.unr.uz", title: "DM-ArcaneTemple", mode: "Deathmatch" },
  "DM-Barricade": { file: "DM-Barricade.unr.uz", title: "DM-Barricade", mode: "Deathmatch" },
  "DM-Codex": { file: "DM-Codex.unr.uz", title: "DM-Codex", mode: "Deathmatch" },
  "DM-Conveyor": { file: "DM-Conveyor.unr.uz", title: "DM-Conveyor", mode: "Deathmatch" },
  "DM-Crane": { file: "DM-Crane.unr.uz", title: "DM-Crane", mode: "Deathmatch" },
  "DM-Curse][": { file: "DM-Curse][.unr.uz", title: "DM-Curse][", mode: "Deathmatch" },
  "DM-Cybrosis][": { file: "DM-Cybrosis][.unr.uz", title: "DM-Cybrosis][", mode: "Deathmatch" },
  "DM-Fetid": { file: "DM-Fetid.unr.uz", title: "DM-Fetid", mode: "Deathmatch" },
  "DM-Fractal": { file: "DM-Fractal.unr.uz", title: "DM-Fractal", mode: "Deathmatch" },
  "DM-Gothic": { file: "DM-Gothic.unr.uz", title: "DM-Gothic", mode: "Deathmatch" },
  "DM-Grinder": { file: "DM-Grinder.unr.uz", title: "DM-Grinder", mode: "Deathmatch" },
  "DM-HealPod][": { file: "DM-HealPod][.unr.uz", title: "DM-HealPod][", mode: "Deathmatch" },
  "DM-HyperBlast": { file: "DM-HyperBlast.unr.uz", title: "DM-HyperBlast", mode: "Deathmatch" },
  "DM-KGalleon": { file: "DM-KGalleon.unr.uz", title: "DM-KGalleon", mode: "Deathmatch" },
  "DM-Liandri": { file: "DM-Liandri.unr.uz", title: "DM-Liandri", mode: "Deathmatch" },
  "DM-Malevolence": { file: "DM-Malevolence.unr.uz", title: "DM-Malevolence", mode: "Deathmatch" },
  "DM-Mojo][": { file: "DM-Mojo][.unr.uz", title: "DM-Mojo][", mode: "Deathmatch" },
  "DM-Morbias][": { file: "DM-Morbias][.unr.uz", title: "DM-Morbias][", mode: "Deathmatch" },
  "DM-Oblivion": { file: "DM-Oblivion.unr.uz", title: "DM-Oblivion", mode: "Deathmatch" },
  "DM-Peak": { file: "DM-Peak.unr.uz", title: "DM-Peak", mode: "Deathmatch" },
  "DM-Phobos": { file: "DM-Phobos.unr.uz", title: "DM-Phobos", mode: "Deathmatch" },
  "DM-Pressure": { file: "DM-Pressure.unr.uz", title: "DM-Pressure", mode: "Deathmatch" },
  "DM-Pyramid": { file: "DM-Pyramid.unr.uz", title: "DM-Pyramid", mode: "Deathmatch" },
  "DM-Shrapnel][": { file: "DM-Shrapnel][.unr.uz", title: "DM-Shrapnel][", mode: "Deathmatch" },
  "DM-SpaceNoxx": { file: "DM-SpaceNoxx.unr.uz", title: "DM-SpaceNoxx", mode: "Deathmatch" },
  "DM-Stalwart": { file: "DM-Stalwart.unr.uz", title: "DM-Stalwart", mode: "Deathmatch" },
  "DM-StalwartXL": { file: "DM-StalwartXL.unr.uz", title: "DM-StalwartXL", mode: "Deathmatch" },
  "DM-Tempest": { file: "DM-Tempest.unr.uz", title: "DM-Tempest", mode: "Deathmatch" },
  "DM-Turbine": { file: "DM-Turbine.unr.uz", title: "DM-Turbine", mode: "Deathmatch" },
  "DM-Zeto": { file: "DM-Zeto.unr.uz", title: "DM-Zeto", mode: "Deathmatch" }
};

export const DEFAULT_MAP = "DM-Deck16][";

export function selectedMap() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("map");
  const id = requested && MAPS[requested] ? requested : DEFAULT_MAP;
  return { id, ...MAPS[id] };
}
