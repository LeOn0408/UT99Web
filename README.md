# UT99Web

Самостоятельный браузерный порт **Unreal Tournament 1999**.

Проект находится в ранней альфе: собственные парсеры UE1 (пакеты, BSP,
текстуры, свет, UnrealScript) и вьюер на Three.js.

## Статус

- [x] Проверка источников: полного исходника UE1 нет, движок пишем свой
- [x] Распаковка `.uz` и чтение пакетов UE1 (`.unr`, `.u`, `.utx`)
- [x] BSP-геометрия и текстуры `.utx`
- [x] Освещение от `Light`-акторов и lightmap-атлас в собственном рендере
- [x] Первый вид: спавн на `PlayerStart`, полёт и ходьба
- [x] Коллизии, гравитация, broad-phase
- [x] Акторы и маркеры предметов
- [x] UnrealScript: таблица классов и иерархия
- [x] UnrealScript: исходники и default properties
- [x] Прототип матча: пикапы, оружие, боты, HUD
- [x] Вьюер на Three.js, главное меню, выбор карты и режима
- [x] Lightmap-атлас и статические тени в Three.js
- [x] 3D-пикапы из бандла: меши, атлас, вращение, подбор оружия
- [x] Боты: коллизии со стенами, пол, линия видимости и урон
- [x] Манифест звуков и музыки: извлечение, проверка форматов, SHA-256
- [x] Звук в игре: Web Audio, выстрелы, подбор, урон, музыка карты
- [x] Пауза с Resume / Restart / Main Menu
- [x] Настройки: чувствительность, качество, громкость, fullscreen
- [x] Счёт матча: фраги, смерти, лимит, финальный экран
- [ ] Пакеты локализации
- [ ] UnrealScript: байткод и VM
- [ ] Упаковка и деплой

## Быстрый запуск

Ассеты готовятся локально из freeware-дистрибутива в
`UT99Web.Frontend/assets/game/` (в git не входят).

Backend (ASP.NET Core, необязателен для просмотра карты):

```sh
dotnet run --project UT99Web.Server
```

Frontend (Node + Three.js):

```sh
cd UT99Web.Frontend
npm install
npm run dev
```

Открыть http://localhost:8124/web/viewer.html.

Альтернативный статический сервер без прокси `/api`:

```sh
cd UT99Web.Frontend
npm run dev:node
```

Открыть http://localhost:8123/web/viewer.html.

Прототип матча: http://localhost:8124/web/viewer.html?walk=1
- `V` — ходьба, `O` — обзор, `Esc` / `P` — пауза;
- на паузе — Resume, Settings, Restart и Main Menu; потеря pointer lock
  автоматически ставит игру на паузу;
- `F` — полноэкранный режим, `Esc` выходит из него средствами браузера;
- WASD/мышь, Space — прыжок, Shift — бег, `1`–`6` — оружие;
- подобранное оружие (`minigun2`, `ripper`, `ut_biorifle`,
  `WarheadLauncher` и др.) автоматически добавляется в инвентарь и
  становится текущим;
- на карте 69 пикапов, 4 бота, HUD с фрагами, смертями,
  здоровьем/бронёй/патронами;
- убийство бота даёт фраг; убитые боты возрождаются через 3 секунды;
- смерть игрока даёт фраг боту-убийце; матч заканчивается, когда игрок
  или бот достигает лимита фрагов (по умолчанию 20), и показывает
  VICTORY/DEFEAT с таблицей и кнопками Rematch / Main Menu;
- боты не проходят сквозь стены, не стреляют через них, а броня
  поглощает урон раньше здоровья;
- звук включается после первого клика или клавиши: выстрелы, подбор,
  прыжок, урон, боты и музыка карты; `M` — выключить/включить звук.

### Настройки

Экран настроек открывается кнопкой **SETTINGS** в главном меню и в
паузе. Доступны чувствительность мыши, качество рендера, общая громкость
и громкость музыки, а также полноэкранный режим. Изменения применяются
сразу и сохраняются в `localStorage` под ключом
`ut99web.settings.v1`; при следующем запуске значения восстанавливаются.
`Back` или `Esc` закрывают настройки и возвращают к паузе или меню.

### Отладочные параметры

- `?map=DM-Morpheus` — выбрать карту;
- `?walk=1`, `?fly=1`, `?menu=0` — сразу матч, полёт или без меню;
- `?lightmap=0` — вершинный свет вместо lightmap-атласа;
- `?shadows=0` — отключить статические тени;
- `?yaw=...&pitch=...` — задать начальный ракурс;
- `?audio=0` — полностью без звука, `?volume=0.8` — общая громкость;
- `?music=0` (или `?music=off`) — без музыки, `?music=Godown` —
  выбрать трек вручную;
- `?sensitivity=1.5`, `?quality=low|medium|high` — перекрыть сохранённые
  настройки на один запуск; `?musicVolume=0.5` — громкость музыки;
- `?fraglimit=10` — лимит фрагов матча (по умолчанию 20).

## Карты и где что менять

- **Добавить карту:** положить `.unr.uz` в `assets/game/Maps/`, добавить
  запись в `web/maps.js` (id → файл и название), открыть
  `?map=DM-Morpheus&walk=1`.
- **3D-меши пикапов:** после добавления карты пересобрать бандл:
  `npm run build:meshes` (по умолчанию Deck16) или явно указать карты:
  `npm run build:meshes -- assets/game/Maps/DM-Morpheus.unr.uz`.
- **Звук и музыка:** `npm run build:audio` извлекает все `Sound` из
  `.uax`/`.u` и `Music` из `.umx` в `assets/game/Audio/`, проверяет
  WAV/PCM и IT/XM и пишет `audio-manifest.json`. Затем
  `npm run build:music` конвертирует IT/XM в OGG через ffmpeg (если
  ffmpeg не установлен, музыка просто не подключается).
- **Где редактировать:**
  - `web/maps.js` — список карт;
  - `web/viewer.js` — игровой цикл, HUD, оружие, боты;
  - `web/settings.js` — настройки, сохранение и URL-перекрытия;
  - `web/audio.js` — Web Audio, звуки и музыка;
  - `engine/src/match/` — таблица счёта и лимит фрагов;
  - `engine/src/level/` — загрузка карты, BSP, свет, коллизии, лифты;
  - `engine/src/texture/`, `engine/src/mesh/` — текстуры и меши;
  - `tools/uscript/` — выгрузка скриптов и сборка мешей;
  - `tools/assets/` — распаковка `.uz`, звук и музыка;
  - `tools/loc/` — извлечение, проверка и сборка локализации;
  - `tasks/` — локальные заметки и задачи (не публикуются).

## Backend и frontend

В решении `UT99Web.sln` два проекта:

- `UT99Web.Server` — ASP.NET Core (.NET 10), API на
  http://localhost:8123;
- `UT99Web.Frontend` — статика, Node + Three.js, dev-сервер на
  http://localhost:8124.

Node-сервер (`server.mjs`) раздаёт статику и проксирует `/api` на
backend. Frontend работает и без backend, если API не нужен.

В Visual Studio можно запускать оба проекта сразу через
`UT99Web.slnLaunch` (Multiple startup projects).

### Backend API (ASP.NET Core)

- `GET /api/health`
- `GET /api/maps`
- `GET /api/assets`
- `GET /api/uscript/classes?filter=`
- `GET /api/uscript/class/{name}`
- `POST /api/game/session` — `{ "botCount": 4 }`
- `POST /api/game/session/{id}/damage` — `{ "target": "player", "amount": 10, "source": "slime" }`
- `POST /api/game/session/{id}/weapon-hit` — `{ "weapon": "ShockRifle", "target": "bot0" }`
- `POST /api/game/session/{id}/bot-hit` — `{ "bot": "bot0" }`
- `POST /api/game/session/{id}/respawn` (параметр `?target=bot0`)

## Проверка вьюера

Smoke-тест запускает `DM-Deck16][` в headless Chrome с аппаратным GPU,
проверяет загрузку карты, отсутствие JS-ошибок и запросов на сторонние
домены, снимает один скриншот и убивает браузер по PID.

```sh
cd UT99Web.Frontend
npm run smoke:viewer
```

Требования: Chrome (или переменная `CHROME_PATH`) и локальные ассеты в
`assets/game/`. Скриншот пишется в `SMOKE_OUT_DIR` (по умолчанию
`%TEMP%`), путь и размер печатаются в выводе. Через `SMOKE_URL` можно
проверить уже запущенный сервер, например
`SMOKE_URL=http://localhost:8124/web/viewer.html?walk=1`.

## Тесты

```sh
cd UT99Web.Frontend
npm test          # критический набор: ассеты, карта, геометрия, боты, звук, счёт, настройки
npm run test:deep # полный набор, включая UnrealScript и локализацию
```

## Лицензии

UT99 распространяется как freeware с разрешения Epic Games. Игровые
ассеты в репозиторий не входят. Three.js используется под лицензией MIT,
текст — в `web/vendor/THREE-LICENSE.txt`.
