# mineflayer-bots — Full System Architecture

> **To-go reference.** Every layer from DonutSMP's game server down to Node.js TCP bytes,
> exactly what calls what, which lib touches which mineflayer API, and how world interaction works.

---

## 1 · Full System Map

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║  DonutSMP GAME SERVER  —  Minecraft 1.21.x                                     ║
║  Paper / Spigot  ·  custom plugins  ·  50 000 players                          ║
╚══════════════════════════════════════╤═════════════════════════════════════════╝
                                       │  1.21.x binary protocol
                                       ▼
╔══════════════════════════════════════════════════════════════════════════════════╗
║  VIAVERSION / VELOCITY PROXY  (DonutSMP infra — not your code)                 ║
║  Translates protocol on-the-fly                                                 ║
║    bot version:'1.20.4'  →  proxy speaks 1.20.4 back to your bot               ║
║    bot version:false     →  proxy speaks native 1.21.x                          ║
╚══════════════════════════════════════╤═════════════════════════════════════════╝
                                       │  TCP/IP  ·  AES-128-CFB8 (post-login)
                                       │           ·  zlib compressed (~256 B threshold)
                                       ▼
╔══════════════════════════════════════════════════════════════════════════════════╗
║  NODE.JS PROCESS  ──  node bot.js <profile>                                    ║
║                                                                                  ║
║ ┌──────────────────────────────────────────────────────────────────────────┐    ║
║ │  minecraft-protocol  v1.66.0  (npm)  —  raw TCP layer                   │    ║
║ │                                                                          │    ║
║ │  Inbound pipeline (wire → bot):          Outbound (bot → wire):         │    ║
║ │  ┌─────────────────────────────────┐     write(packetName, params)       │    ║
║ │  │ node:net.Socket  (OS TCP)       │       → serializer → compress       │    ║
║ │  │   ↓ framing.js                  │       → encrypt → frame → socket    │    ║
║ │  │   varint length-prefix frames   │                                     │    ║
║ │  │   ↓ encryption.js               │  bot._client  (EventEmitter)        │    ║
║ │  │   AES-128-CFB8 stream cipher    │    .on('packet', fn)  parsed IN     │    ║
║ │  │   ↓ compression.js              │    .on('raw', fn)     hex buffer IN │    ║
║ │  │   zlib inflate                  │    .write(name, p)    send OUT      │    ║
║ │  │   ↓ serializer.js (protodef)    │    .prependListener() before others │    ║
║ │  │   reads minecraft-data schemas  │    .state  handshake|login|play     │    ║
║ │  │   → decoded packet object       │                                     │    ║
║ │  └─────────────────────────────────┘  Microsoft auth (auth:'microsoft'): │    ║
║ │                                         OAuth2 device-code → MS token    │    ║
║ │                                         → Xbox Live → MC token            │    ║
║ │                                         → AES shared secret handshake     │    ║
║ │                                         cached in auth-cache/ next run    │    ║
║ └──────────────────────────────┬───────────────────────────────────────────┘    ║
║               bot._client ─────┘  (EventEmitter carrying decoded packets)       ║
║                                                                                  ║
║ ┌──────────────────────────────────────────────────────────────────────────┐    ║
║ │  mineflayer  v4.37.0  (npm)  —  "Minecraft client" library              │    ║
║ │                                                                          │    ║
║ │  createBot(cfg) loads 42 internal plugins + returns bot object           │    ║
║ │                                                                          │    ║
║ │  KEY INTERNAL PLUGINS:                                                   │    ║
║ │  ┌──────────────────────────────────────────────────────────────────┐   │    ║
║ │  │ entities.js   handles entity_velocity · spawn_entity packets     │   │    ║
║ │  │               builds bot.entities map                            │   │    ║
║ │  │               ⚠ BUG: reads packet.velocityX (flat, undefined)   │   │    ║
║ │  │                  mc-data decoded as velocity:{x,y,z} (nested)   │   │    ║
║ │  │                  → Vec3(NaN,NaN,NaN)                             │   │    ║
║ │  │               ✓ velocityPatch.js prependListener fixes upstream  │   │    ║
║ │  ├──────────────────────────────────────────────────────────────────┤   │    ║
║ │  │ physics.js    simulates gravity + movement every game tick       │   │    ║
║ │  │               reads entity.velocity → applies to position        │   │    ║
║ │  │               ⚠ if NaN flows in (unfixed): position → NaN       │   │    ║
║ │  ├──────────────────────────────────────────────────────────────────┤   │    ║
║ │  │ chat.js       parse/send chat · emits 'chat', 'whisper'         │   │    ║
║ │  │ health.js     HP · food · saturation · emits 'health', 'death'  │   │    ║
║ │  │ inventory.js  slots · containers · emits 'windowOpen/Close'     │   │    ║
║ │  │ digging.js    break animation · implements bot.dig()            │   │    ║
║ │  │ blocks.js     chunk tracking · implements bot.findBlocks()      │   │    ║
║ │  │ craft.js      crafting · implements bot.craft(), recipesFor()   │   │    ║
║ │  │ chest.js      chest / barrel / shulker open-close-transfer      │   │    ║
║ │  │ tablist.js    player list from player_info packets              │   │    ║
║ │  │ kick.js       disconnect packet · emits 'kicked', 'end'         │   │    ║
║ │  │ game.js       game state · difficulty · world border            │   │    ║
║ │  │ villager.js   trade window UI                                   │   │    ║
║ │  │ + 31 more: anvil · bed · boss_bar · creative · explosion        │   │    ║
║ │  │             fishing · furnace · particle · rain · scoreboard    │   │    ║
║ │  │             sound · time · title · place_block · ...            │   │    ║
║ │  └──────────────────────────────────────────────────────────────────┘   │    ║
║ │                                                                          │    ║
║ │  BOT API SURFACE  (what your code calls):                                │    ║
║ │  State      bot.entity          your position · velocity · yaw · pitch   │    ║
║ │             bot.entities[id]    every loaded entity in render distance    │    ║
║ │             bot.players[name]   tablist + entity reference                │    ║
║ │             bot.inventory       your slots  (items(), findInventoryItem)  │    ║
║ │             bot.username / bot.version / bot._client                      │    ║
║ │  World      bot.findBlocks(opts)          bot.blockAt(vec3)               │    ║
║ │             bot.nearestEntity(pred)                                        │    ║
║ │  Action     bot.chat(msg)                 bot.quit()                      │    ║
║ │             bot.dig(block)                bot.placeBlock(block, face)     │    ║
║ │             bot.equip(item, dest)         bot.attack(entity)              │    ║
║ │             bot.lookAt(vec3)              bot.setControlState(ctrl, bool) │    ║
║ │  Crafting   bot.craft(recipe, n, table)   bot.recipesFor(id, null, n, t) │    ║
║ │             bot.openChest(block)          bot.openFurnace(block)          │    ║
║ │  Plugins    bot.pathfinder.*    added by mineflayer-pathfinder            │    ║
║ │             bot.collectBlock.*  added by mineflayer-collectblock          │    ║
║ └──────────────────────────────────────────────────────────────────────────┘    ║
║                   ↑ bot object passed everywhere through your code              ║
║                                                                                  ║
║ ┌────────────────────────────────┐  ┌───────────────────────────────────────┐   ║
║ │  mineflayer-pathfinder  v2.4.5 │  │  mineflayer-collectblock  v1.6.0     │   ║
║ │  A* grid pathfinding           │  │  High-level item pickup               │   ║
║ │  loaded: bot.loadPlugin(pf)    │  │  loaded: bot.loadPlugin(cb)           │   ║
║ │  adds bot.pathfinder:          │  │  adds bot.collectBlock:               │   ║
║ │    .setMovements(Movements)    │  │    .collect(block | block[])          │   ║
║ │    .setGoal(goal, dynamic?)    │  │    pathfinds to item entity           │   ║
║ │    .goto(goal) ← awaitable     │  │    waits until picked up             │   ║
║ │    .stop() / .isMoving()       │  │  used by: skills.pickupNearbyItems() │   ║
║ │  Goals (pf.goals.*):           │  └───────────────────────────────────────┘   ║
║ │    GoalBlock · GoalNear        │                                               ║
║ │    GoalFollow · GoalBreakBlock │  Both loaded inside mc.init(bot) via          ║
║ │    GoalLookAtBlock · GoalXZ    │  bot.loadPlugin() on 'login' event            ║
║ │  Movements: canDig, towers...  │                                               ║
║ │  used by: skills.js · world.js │                                               ║
║ └────────────────────────────────┘                                               ║
║                                                                                  ║
║ ┌──────────────────────────────────────────────────────────────────────────┐    ║
║ │  YOUR CODE  —  mineflayer-bots/                                         │    ║
║ │                                                                          │    ║
║ │ ┌─────────────────────────────────────────────────────────────────────┐ │    ║
║ │ │  profiles/  ─────────────────────────────────────────────────────  │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  _base.js (shared — spread into every profile)                     │ │    ║
║ │ │    bot:   host:donutsmp.net · port:25565 · auth:'microsoft'        │ │    ║
║ │ │           version:'1.20.4' · profilesFolder:./auth-cache           │ │    ║
║ │ │    skills: blockPlaceDelay:0                                        │ │    ║
║ │ │    viewer: enabled:true · port:3000 · firstPerson:false            │ │    ║
║ │ │    protocolDebug: enabled:false · logFile · onlyPacketNames        │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  sentinel.js        debug.js           trader.js                   │ │    ║
║ │ │  spread _base       spread _base        spread _base               │ │    ║
║ │ │  viewer port:3000   viewer port:3002    viewer port:3001           │ │    ║
║ │ │  triggers:          triggers:           triggers:                  │ │    ║
║ │ │   playerRadius       onSpawn(1s)          onSpawn(3s)             │ │    ║
║ │ │    alert@3             →/skyblock           →/warp market          │ │    ║
║ │ │    panic@0             →debugScan(r=8)    blockNearby(chest,r=20) │ │    ║
║ │ │    →breakAllBlocks                          →takeFromChest(bone)   │ │    ║
║ │ │      (spawner,r=64)                         →/sell all             │ │    ║
║ │ │    →dropItems(spawner)                      →pickupItems           │ │    ║
║ │ │    →disconnect                            playerRadius             │ │    ║
║ │ │                                             alert@10, panic@5      │ │    ║
║ │ │                                             →disconnect            │ │    ║
║ │ └─────────────────────────────────────────────────────────────────────┘ │    ║
║ │                  │  exports { bot, skills, viewer, triggers, protocolDebug }  ║
║ │                  ▼                                                       │    ║
║ │ ┌─────────────────────────────────────────────────────────────────────┐ │    ║
║ │ │  bot.js  —  SINGLE-BOT ENTRY POINT (thin wrapper)                  │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  createBotSession(profileName)  → { bot, promise }                 │ │    ║
║ │ │  promise.then  → process.exit(0)                                   │ │    ║
║ │ │  promise.catch → process.exit(1)                                   │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  All session logic lives in lib/createBotSession.js               │ │    ║
║ │ │  For multi-bot + auto-reconnect: use orchestrator.js              │ │    ║
║ │ └─────────────────────────────────────────────────────────────────────┘ │    ║
║ │                  │  fires triggers at spawn                              │    ║
║ │                  ▼                                                       │    ║
║ │ ┌─────────────────────────────────────────────────────────────────────┐ │    ║
║ │ │  triggers/  ──────────────────────────────────────────────────────  │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  index.js   exports createTriggerRegistry() — called once per      │ │    ║
║ │ │             bot session; returns { registerTrigger, stopAll }      │ │    ║
║ │ │                                                                     │ │    ║
║ │ │             registry: { playerRadius, blockNearby, onSpawn }       │ │    ║
║ │ │             let running=false; queue=[]  ← per-session state       │ │    ║
║ │ │             let cleanups=[]  ← cancel() handles from handlers      │ │    ║
║ │ │                                                                     │ │    ║
║ │ │             registerTrigger(bot, cfg):                              │ │    ║
║ │ │               priority = cfg.priority ?? 0                         │ │    ║
║ │ │               fire = (ctx) => {                                     │ │    ║
║ │ │                 if (bot._quitting) return                           │ │    ║
║ │ │                 push { priority, fn: executeActions(ctx) }          │ │    ║
║ │ │                 flush()  ← sorts by priority, drains one at a time │ │    ║
║ │ │               }  ← sensing stays parallel; execution is serialised │ │    ║
║ │ │               cleanup = registry[cfg.type](bot, cfg.options, fire) │ │    ║
║ │ │               if cleanup?.cancel → cleanups.push(cancel)           │ │    ║
║ │ │             stopAll() → calls every cleanup.cancel()               │ │    ║
║ │ │               ← called on session end by createBotSession          │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  playerRadius.js                                                    │ │    ║
║ │ │    slow setInterval (checkIntervalMs)                               │ │    ║
║ │ │      world.getNearbyPlayers(bot, printRadius) → log [DIST]         │ │    ║
║ │ │      world.getNearestEntityWhere(bot, pred, alertRadius)            │ │    ║
║ │ │        → hit: fire(context) + arm fast panic watch                 │ │    ║
║ │ │    fast setInterval (panicIntervalMs, armed after alert)            │ │    ║
║ │ │      world.getNearestEntityWhere(bot, pred, panicRadius)            │ │    ║
║ │ │        → hit: bot._quitting=true · pathfinder.stop() · bot.quit() │ │    ║
║ │ │             ← emergency, bypasses action queue entirely             │ │    ║
║ │ │    panicRadius ≤ 0 → guard skips startPanicWatch entirely          │ │    ║
║ │ │    returns { cancel() { clearInterval(slow+fast) } }               │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  blockNearby.js                                                     │ │    ║
║ │ │    setInterval (checkIntervalMs)                                    │ │    ║
║ │ │      world.getNearestBlock(bot, blockName, radius)                  │ │    ║
║ │ │        → found: fire({ block }) · clearInterval · triggered=true   │ │    ║
║ │ │    returns { cancel() { clearInterval } }                           │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  onSpawn.js                                                         │ │    ║
║ │ │    setTimeout(delayMs) → fire({}) once                              │ │    ║
║ │ │    returns { cancel() { clearTimeout } }                            │ │    ║
║ │ └─────────────────────────────────────────────────────────────────────┘ │    ║
║ │                  │  fire() → executeActions()                            │    ║
║ │                  ▼                                                       │    ║
║ │ ┌─────────────────────────────────────────────────────────────────────┐ │    ║
║ │ │  actions/  ───────────────────────────────────────────────────────  │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  index.js   executeActions(bot, actionConfigs, context={})          │ │    ║
║ │ │             for...of ← sequential, fully awaited                    │ │    ║
║ │ │             bot._quitting check per step ← aborts chain on quit    │ │    ║
║ │ │             opts.timeoutMs ← optional per-action timeout           │ │    ║
║ │ │             context passed as 3rd arg to every handler             │ │    ║
║ │ │             try/catch per action ← logs warn, continues stack       │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  breakBlock.js        world.getNearestBlock()                       │ │    ║
║ │ │                       skills.breakBlockAt(x,y,z)                   │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  breakAllBlocks.js    world.getNearestBlocks()  [re-scans in loop]  │ │    ║
║ │ │                       skills.goToPosition(x,y,z, stopAt=4)         │ │    ║
║ │ │                       bot.setControlState('sneak', true)            │ │    ║
║ │ │                       skills.breakBlockAt(x,y,z)                   │ │    ║
║ │ │                       bot.setControlState('sneak', false)           │ │    ║
║ │ │                       await random delay (400–1600 ms)              │ │    ║
║ │ │                       repeat until empty · cap: maxRounds=500       │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  takeFromChest.js     skills.takeFromChest(itemName, num)           │ │    ║
║ │ │  goToBlock.js         skills.goToNearestBlock(name, minDist, r)    │ │    ║
║ │ │  pickupItems.js       skills.pickupNearbyItems()                    │ │    ║
║ │ │  dropItems.js         bot.inventory.items()  +  skills.discard()    │ │    ║
║ │ │  sendChat.js          bot.chat(message)  +  await delay             │ │    ║
║ │ │  disconnect.js        bot.quit()                                    │ │    ║
║ │ │  startDebugScan.js    setInterval (non-blocking, background loop)   │ │    ║
║ │ │                       world.getPosition()                           │ │    ║
║ │ │                       world.getNearbyBlockTypes(radius)             │ │    ║
║ │ │                       world.getNearbyEntities(radius)               │ │    ║
║ │ └─────────────────────────────────────────────────────────────────────┘ │    ║
║ │           │ call world.*        │ call skills.*        │ call bot.* directly ║
║ │           ▼                     ▼                      ▼                 │    ║
║ │ ┌───────────────────────┐ ┌───────────────────────────────────────────┐ │    ║
║ │ │  lib/world.js         │ │  lib/skills.js                            │ │    ║
║ │ │  Spatial queries      │ │  High-level async actions (mindcraft)     │ │    ║
║ │ │  (mindcraft origin)   │ │                                           │ │    ║
║ │ │                       │ │  Calls mineflayer API:                    │ │    ║
║ │ │  Calls mineflayer:    │ │    bot.dig(block)                         │ │    ║
║ │ │   bot.findBlocks()    │ │    bot.equip(item, dest)                  │ │    ║
║ │ │   bot.blockAt(vec3)   │ │    bot.craft(recipe, n, table)            │ │    ║
║ │ │   bot.entity.position │ │    bot.openChest(block)                   │ │    ║
║ │ │   bot.entities        │ │    bot.openFurnace(block)                 │ │    ║
║ │ │   bot.players         │ │    bot.recipesFor(id, null, n, table)     │ │    ║
║ │ │   bot.nearestEntity() │ │    bot.pathfinder.setMovements(Movements) │ │    ║
║ │ │   bot.inventory.items │ │    bot.pathfinder.setGoal(goal)           │ │    ║
║ │ │  Also uses:           │ │    bot.pathfinder.goto(goal) ← awaitable  │ │    ║
║ │ │   pf.Movements        │ │    bot.collectBlock.collect(block[])      │ │    ║
║ │ │   mcdata (block IDs)  │ │    bot.setControlState(ctrl, bool)        │ │    ║
║ │ │                       │ │    bot.lookAt(vec3)                       │ │    ║
║ │ │  Exports:             │ │    bot.attack(entity)                     │ │    ║
║ │ │   getNearestBlock     │ │    bot.placeBlock(block, faceVec)         │ │    ║
║ │ │   getNearestBlocks    │ │    bot.inventory.items()                  │ │    ║
║ │ │   getNearestFreeSpace │ │    bot.armorManager.equipAll()            │ │    ║
║ │ │   getBlockAtPosition  │ │    bot.modes.pause() ← stub in session   │ │    ║
║ │ │   getFirstBlockAbove  │ │  Also uses:                               │ │    ║
║ │ │   getNearbyEntities   │ │    world.* · mcdata.* · pf.goals.*       │ │    ║
║ │ │   getNearestEntity    │ │    Vec3                                   │ │    ║
║ │ │     Where(pred, dist) │ │    blockDelay(bot) → reads               │ │    ║
║ │ │                       │ │      bot._config.skills.blockPlaceDelay  │ │    ║
║ │ │                       │ │      per-call (not module-level constant) │ │    ║
║ │ │   getNearbyPlayers    │ │  Exports:                                 │ │    ║
║ │ │   getPosition         │ │    breakBlockAt(bot, x,y,z)               │ │    ║
║ │ │   getNearbyBlockTypes │ │    goToPosition(bot, x,y,z, minDist)      │ │    ║
║ │ │   getInventoryCounts  │ │    goToNearestBlock(name, minDist, r)     │ │    ║
║ │ │   shouldPlaceTorch    │ │    takeFromChest(itemName, num)           │ │    ║
║ │ └───────────────────────┘ │    discard(itemName, count)               │ │    ║
║ │           │ uses mcdata    │    pickupNearbyItems()                    │ │    ║
║ │           │                │    craftRecipe(itemName, num)            │ │    ║
║ │           ▼                │    smeltItem(itemName, num)              │ │    ║
║ │ ┌──────────────────────┐   │    attackNearest(mobName, kill)          │ │    ║
║ │ │  lib/mcdata.js        │   │    placeBlock(name, x,y,z, face)        │ │    ║
║ │ │  Data wrapper +       │   │    tillAndSow(x,y,z, seedName)          │ │    ║
║ │ │  plugin loader        │   │    autoLight()  equipHighestAttack()    │ │    ║
║ │ │                       │   │    wait(ms)                             │ │    ║
║ │ │  init(bot):           │   └───────────────────────────────────────────┘ │    ║
║ │ │   bot.loadPlugin(pf)  │                                               │    ║
║ │ │   bot.loadPlugin(cb)  │  ┌─────────────────────────────────────────┐  │    ║
║ │ │   on 'login':         │  │  lib/velocityPatch.js  ◄── BUG FIX     │  │    ║
║ │ │    mc_version=        │  │  applyVelocityPatch(bot):               │  │    ║
║ │ │      bot.version      │  │   bot._client.prependListener(          │  │    ║
║ │ │    mcdata=            │  │     'entity_velocity', normalise)       │  │    ║
║ │ │      minecraftData(v) │  │   bot._client.prependListener(          │  │    ║
║ │ │    Item=              │  │     'spawn_entity', normalise)          │  │    ║
║ │ │      prismarine_items │  │   normalise: copies packet.velocity     │  │    ║
║ │ │        (mc_version)   │  │     .{x,y,z} → packet.velocityX/Y/Z   │  │    ║
║ │ │                       │  │   runs BEFORE entities.js handler       │  │    ║
║ │ │  Exports:             │  └─────────────────────────────────────────┘  │    ║
║ │ │   getItemId/Name      │                                               │    ║
║ │ │   getBlockId/Name     │  ┌─────────────────────────────────────────┐  │    ║
║ │ │   getEntityId         │  │  lib/protocolDebug.js  (opt-in tracer)  │  │    ║
║ │ │   getAllItems/Blocks   │  │  attachProtocolDebug(bot, opts):        │  │    ║
║ │ │   getItemCrafting      │  │   bot._client.on('packet')  parsed IN  │  │    ║
║ │ │     Recipes           │  │   bot._client.on('raw')     hex IN      │  │    ║
║ │ │   getDetailedCrafting  │  │   wraps bot._client.write() OUT        │  │    ║
║ │ │     Plan              │  │   streams to logs/protocol*.log         │  │    ║
║ │ │   makeItem            │  │  env: MC_PROTOCOL_DEBUG=1               │  │    ║
║ │ │   getBlockTool        │  └─────────────────────────────────────────┘  │    ║
║ │ │   isSmeltable         │                                               │    ║
║ │ │   isHuntable          │  ┌─────────────────────────────────────────┐  │    ║
║ │ │   isHostile           │  │  lib/runtimeConfig.js  (LEGACY)         │  │    ║
║ │ │   mustCollectManually │  │  Singleton: set(profile) · get()        │  │    ║
║ │ │   ingredientsFrom     │  │  ⚠ No longer used by skills.js or      │  │    ║
║ │ │     PrismarineRecipe  │  │    createBotSession. Kept in repo for   │  │    ║
║ │ │   calculateLimiting   │  │    backward compatibility only.         │  │    ║
║ │ │     Resource          │  │  skills.js now uses blockDelay(bot)     │  │    ║
║ │ │                       │  │  which reads bot._config per-call.      │  │    ║
║ │ │                       │  └─────────────────────────────────────────┘  │    ║
║ │ └──────────────────────┘                                               │    ║
║ │                                                                          │    ║
║ │ ┌─────────────────────────────────────────────────────────────────────┐ │    ║
║ │ │  lib/createBotSession.js  —  SESSION FACTORY                       │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  createBotSession(profileName) → { bot, promise }                  │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  ① profile = require('../profiles/<name>')                         │ │    ║
║ │ │  ② bot = mineflayer.createBot(profile.bot)                        │ │    ║
║ │ │  ③ bot._config = profile   ← per-bot config; no global singleton  │ │    ║
║ │ │    bot._profileName = profileName                                  │ │    ║
║ │ │    bot._quitting = false                                           │ │    ║
║ │ │    bot.output='' · bot.modes=stubs  (mindcraft compat)            │ │    ║
║ │ │  ④ attachProtocolDebug(bot, mergedOpts)                           │ │    ║
║ │ │  ⑤ applyVelocityPatch(bot)                                        │ │    ║
║ │ │  ⑥ mc.init(bot)  → loadPlugin(pathfinder+collectblock)           │ │    ║
║ │ │  ⑦ { registerTrigger, stopAll } = createTriggerRegistry()        │ │    ║
║ │ │     ← per-session; isolated queue + cleanup handles               │ │    ║
║ │ │  ⑧ bot.once('spawn'):                                             │ │    ║
║ │ │       mineflayerViewer(bot, ...) if viewer.enabled                │ │    ║
║ │ │       for cfg of profile.triggers: registerTrigger(bot, cfg)      │ │    ║
║ │ │  ⑨ promise = new Promise((resolve, reject) => {                  │ │    ║
║ │ │       bot.on('login')  → log                                      │ │    ║
║ │ │       bot.on('error')  → log (does NOT reject)                   │ │    ║
║ │ │       bot.on('kicked') → stopAll(); reject({ type:'kicked' })    │ │    ║
║ │ │       bot.on('end')    → stopAll()                                │ │    ║
║ │ │                           resolve({ reason, intentional:         │ │    ║
║ │ │                             bot._quitting })                      │ │    ║
║ │ │     })                                                            │ │    ║
║ │ │                                                                   │ │    ║
║ │ │  Does NOT call process.exit() — caller owns process lifecycle    │ │    ║
║ │ └─────────────────────────────────────────────────────────────────────┘ │    ║
║ │                                                                          │    ║
║ │ ┌─────────────────────────────────────────────────────────────────────┐ │    ║
║ │ │  lib/BotManager.js  —  PER-PROFILE LIFECYCLE                       │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  extends EventEmitter                                               │ │    ║
║ │ │  constructor({ profile, reconnect, maxRetries, baseDelayMs })      │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  State machine:                                                     │ │    ║
║ │ │    IDLE → CONNECTING → CONNECTED → DISCONNECTED                   │ │    ║
║ │ │             ↑                           ↓                          │ │    ║
║ │ │             └──────── RECONNECTING ─────┘                          │ │    ║
║ │ │                              ↓                                     │ │    ║
║ │ │                     STOPPED (intentional quit or stop() called)    │ │    ║
║ │ │                     FAILED  (maxRetries exceeded)                  │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  start()  → enters CONNECTING, calls createBotSession in loop     │ │    ║
║ │ │  stop()   → sets _stopped=true, bot._quitting=true, bot.quit()   │ │    ║
║ │ │  getSnapshot() → { profile, state, attempt, uptime }              │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  Reconnect logic:                                                  │ │    ║
║ │ │    intentional=true → STOPPED (no reconnect)                      │ │    ║
║ │ │    unexpected end / kick → RECONNECTING                           │ │    ║
║ │ │    delay = min(baseDelayMs × 2^attempt, 60000)                    │ │    ║
║ │ │    attempt > maxRetries → FAILED                                   │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  Events emitted:                                                   │ │    ║
║ │ │    'stateChange'   { profile, state, attempt, uptime }             │ │    ║
║ │ │    'reconnecting'  { profile, attempt, delay }                     │ │    ║
║ │ │    'error'         { profile, error, attempt }                     │ │    ║
║ │ └─────────────────────────────────────────────────────────────────────┘ │    ║
║ │                                                                          │    ║
║ │ ┌─────────────────────────────────────────────────────────────────────┐ │    ║
║ │ │  lib/EventBus.js  —  CROSS-BOT EVENT BUS                           │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  Singleton EventEmitter shared across all sessions in the process  │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  Published by orchestrator:                                        │ │    ║
║ │ │    'bot:stateChange'   { profile, state, attempt, uptime }         │ │    ║
║ │ │    'bot:error'         { profile, error, attempt }                 │ │    ║
║ │ │    'bot:reconnecting'  { profile, attempt, delay }                 │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  Future patterns (publish from actions/triggers):                 │ │    ║
║ │ │    'world:spawnerFound'  { profile, position }                     │ │    ║
║ │ │    'world:playerSeen'    { profile, username, distance }           │ │    ║
║ │ │    'trade:cycleComplete' { profile, items }                        │ │    ║
║ │ │  → other bots or GUI subscribe and coordinate via EventBus        │ │    ║
║ │ └─────────────────────────────────────────────────────────────────────┘ │    ║
║ │                                                                          │    ║
║ │ ┌─────────────────────────────────────────────────────────────────────┐ │    ║
║ │ │  orchestrator.js  —  MULTI-BOT ENTRY POINT                         │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  managers = Map<profileName, BotManager>                            │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  spawnBot(config)   → creates BotManager, wires EventBus, starts  │ │    ║
║ │ │  stopBot(name)      → manager.stop()                               │ │    ║
║ │ │  getBotStates()     → [ manager.getSnapshot(), ... ]               │ │    ║
║ │ │                         ← initial data for GUI render              │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  CLI: node orchestrator.js sentinel trader                         │ │    ║
║ │ │  Module: const { spawnBot, EventBus } = require('./orchestrator')  │ │    ║
║ │ │                                                                     │ │    ║
║ │ │  SIGINT handler → manager.stop() for all → setTimeout 1.5s exit   │ │    ║
║ │ └─────────────────────────────────────────────────────────────────────┘ │    ║
║ │                                                                          │    ║
║ └──────────────────────────────────────────────────────────────────────────┘    ║
║                                                                                  ║
║ ┌──────────────────────────────────────────────────────────────────────────┐    ║
║ │  SUPPORT / DATA PACKAGES  (npm)                                         │    ║
║ │                                                                          │    ║
║ │  minecraft-data  v3.109.0   Version-specific game data (static JSON)    │    ║
║ │                             blocks · items · entities · biomes           │    ║
║ │                             crafting recipes · packet schemas            │    ║
║ │                             entity_velocity schema → {velocity:vec3i16} │    ║
║ │                             used by: mcdata.js · mineflayer · mc-proto  │    ║
║ │                                                                          │    ║
║ │  prismarine-item  v1.18.0   Minecraft item object (id · count · nbt)    │    ║
║ │                             used by: mcdata.makeItem()                   │    ║
║ │                                                                          │    ║
║ │  vec3  v0.2.0               3D vector math · new Vec3(x,y,z)            │    ║
║ │                             .offset() · .distanceTo() · .clone()        │    ║
║ │                             used by: skills.js · mineflayer internals    │    ║
║ │                                                                          │    ║
║ │  prismarine-viewer  v1.33.0 Browser 3D world renderer                   │    ║
║ │                             mineflayerViewer(bot, {port, firstPerson})  │    ║
║ │                             → HTTP server at http://localhost:<port>     │    ║
║ │                             → streams chunk data over WebSocket          │    ║
║ │                             started on 'spawn' if viewer.enabled:true    │    ║
║ │                             requires: canvas (C++ native addon)          │    ║
║ │                                                                          │    ║
║ │  canvas  v3.x               Native C++ Node addon · server-side Canvas   │    ║
║ │                             required by prismarine-viewer                │    ║
║ └──────────────────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

---

## 2 · Boot Sequence (ordered)

### Path A — Single bot: `node bot.js sentinel`

```
node bot.js sentinel
  │
  ├─ createBotSession('sentinel')             [lib/createBotSession.js]
  │    ├─ profile = require('./profiles/sentinel')   [spreads _base]
  │    ├─ bot = mineflayer.createBot(profile.bot)
  │    │    └─ minecraft-protocol.createClient()    [TCP → handshake → login]
  │    │         └─ Microsoft auth flow             [device-code / token cache]
  │    ├─ bot._config = profile               [per-session; no global singleton]
  │    ├─ bot._profileName = 'sentinel'
  │    ├─ bot._quitting = false
  │    ├─ bot.output='' · bot.modes=stubs    [mindcraft compat shims]
  │    ├─ attachProtocolDebug(bot, mergedOpts)
  │    ├─ applyVelocityPatch(bot)             [prependListener on entity_velocity + spawn_entity]
  │    ├─ mc.init(bot)
  │    │    ├─ bot.loadPlugin(pathfinder)     [adds bot.pathfinder.*]
  │    │    ├─ bot.loadPlugin(collectblock)   [adds bot.collectBlock.*]
  │    │    └─ bot.once('login'):
  │    │         mc_version = bot.version
  │    │         mcdata = minecraftData(mc_version)
  │    │         Item   = prismarine_items(mc_version)
  │    ├─ { registerTrigger, stopAll } = createTriggerRegistry()
  │    │    ← isolated per-session; own priority queue + cleanups array
  │    ├─ bot.once('spawn'):                  ← once() prevents re-registration on /warp
  │    │    ├─ (opt) mineflayerViewer(bot, { port, firstPerson })
  │    │    └─ for cfg of profile.triggers:
  │    │         cleanup = registry[cfg.type](bot, cfg.options, fire)
  │    │         if cleanup?.cancel → cleanups.push(cancel)
  │    └─ promise settled by:
  │         bot.on('login')  → log
  │         bot.on('error')  → log (non-fatal)
  │         bot.on('kicked') → stopAll() → reject({ type:'kicked', ... })
  │         bot.on('end')    → stopAll() → resolve({ reason, intentional })
  │
  └─ promise.then  → process.exit(0)
     promise.catch → process.exit(1)
```

### Path B — Multi-bot: `node orchestrator.js sentinel trader`

```
node orchestrator.js sentinel trader
  │
  ├─ for each profileName in argv:
  │    spawnBot({ profile: profileName, reconnect:true, maxRetries:10 })
  │      └─ manager = new BotManager(config)
  │           manager.on('stateChange')  → EventBus.emit('bot:stateChange', ...)
  │           manager.on('error')        → EventBus.emit('bot:error', ...)
  │           manager.on('reconnecting') → EventBus.emit('bot:reconnecting', ...)
  │           managers.set(profileName, manager)
  │           manager.start()
  │             └─ _run():   [async loop]
  │                  ① setState(CONNECTING)
  │                  ② { bot, promise } = createBotSession(profileName)
  │                     [same as Path A: patches, plugins, registry, triggers]
  │                  ③ bot.on('login') → setState(CONNECTED), reset attempt
  │                  ④ await promise
  │                  ⑤ on resolve({ intentional:true }) → setState(STOPPED), break
  │                     on resolve({ intentional:false }) → setState(DISCONNECTED)
  │                     on reject (kick) → setState(DISCONNECTED)
  │                  ⑥ if !_stopped → setState(RECONNECTING)
  │                       delay = min(baseDelayMs × 2^attempt, 60000)
  │                       attempt > maxRetries → setState(FAILED), break
  │                       await sleep(delay) → loop back to ①
  │
  └─ SIGINT → all managers.stop() → setTimeout 1500ms → process.exit(0)
```

---

## 3 · Trigger → Action Data Flow

```
                     ┌─────────────────────────────────────────────────────────┐
profile.triggers[n]  │  type: 'playerRadius'                                   │
                     │  priority: 10  (optional; higher = runs first in queue)  │
                     │  options: { alertRadius:3, ... }                         │
                     │  actions: [ {type:'breakAllBlocks', options:{timeoutMs:300000}},│
                     │             {type:'disconnect'} ]                        │
                     └────────────────────┬────────────────────────────────────┘
                                          │ registerTrigger(bot, cfg)
                                          ▼
                          triggers/playerRadius.js        triggers/blockNearby.js
                          triggers/onSpawn.js             [all run in PARALLEL — sensing]
                          setInterval / setTimeout
                          world.getNearestEntityWhere()
                          → match! → fire(context)
                                          │
                                          ▼
                     triggers/index.js  fire(context)     [per-session createTriggerRegistry()]
                       push { priority, fn: ()=>executeActions(bot, cfg.actions, context) }
                       queue.sort((a,b) => b.priority - a.priority)
                       flush():  if running → return (will drain after current finishes)
                                 running=true; dequeue head; await fn(); running=false
                                 ← action chains SERIALISED; highest priority runs next
                                 ← active chain is NEVER preempted (runs to completion)
                              for...of  (sequential await inside executeActions)
                              bot._quitting check per step  ← aborts chain on quit
                              opts.timeoutMs → Promise.race([run, timeout])
                              try/catch per action → logs warn, continues to next
                                          │
                       ┌──────────────────┴──────────────────┐
                       ▼                                     ▼
              breakAllBlocks                           disconnect
              world.getNearestBlocks()                 bot._quitting = true
              skills.goToPosition()                    bot.pathfinder.stop()
              skills.breakBlockAt()                    bot.quit()
              [timeoutMs: 300000 caps entire loop]

  ─────────────────────────────────────────────────────────────────────────────
  EMERGENCY PATH (panic — bypasses queue entirely):
    playerRadius.js fast interval → bot._quitting=true · pathfinder.stop() · bot.quit()
    ← direct call; does not wait for any running or queued action to finish
  ─────────────────────────────────────────────────────────────────────────────
```

---

## 4 · World Interaction — How the Bot Reads/Modifies the World

| Operation | Your Code | lib | mineflayer API | minecraft-protocol packet |
|-----------|-----------|-----|----------------|--------------------------|
| Find nearby block | `world.getNearestBlock(bot, 'chest', 32)` | world.js | `bot.findBlocks({matching, maxDistance})` | chunk data (already received) |
| Get block at position | `world.getBlockAtPosition(bot, 0,-1,0)` | world.js | `bot.blockAt(vec3)` | chunk data |
| Find nearby players | `world.getNearbyPlayers(bot, 50)` | world.js | `bot.players` / `bot.entities` | `player_info`, `spawn_entity` |
| Find entity by predicate | `world.getNearestEntityWhere(bot, pred, r)` | world.js | `bot.nearestEntity(pred)` | `spawn_entity`, `move_entity` |
| Get own position | `world.getPosition(bot)` | world.js | `bot.entity.position` | `sync_entity_position` |
| Get inventory counts | `world.getInventoryCounts(bot)` | world.js | `bot.inventory.items()` | `set_slot`, `window_items` |
| **Break a block** | `skills.breakBlockAt(bot, x,y,z)` | skills.js | `bot.dig(block)` | `player_digging` → `block_change` |
| **Navigate to position** | `skills.goToPosition(bot, x,y,z, minDist)` | skills.js | `bot.pathfinder.setGoal(GoalNear)` | `set_player_position` (per tick) |
| **Take from chest** | `skills.takeFromChest(bot, name, num)` | skills.js | `bot.openChest(block)` → window API | `click_window` / `window_items` |
| **Drop items** | `skills.discard(bot, name, count)` | skills.js | `bot.toss(itemId, null, count)` | `player_block_placement` |
| **Pick up items** | `skills.pickupNearbyItems(bot)` | skills.js | `bot.collectBlock.collect(block[])` | movement packets → `player_collect` |
| **Send chat/cmd** | `bot.chat(message)` | — | `bot.chat(msg)` | `chat_message` |
| **Disconnect** | `bot.quit()` | — | `bot.quit()` | clean disconnect packet |
| **Sneak** | `bot.setControlState('sneak', true)` | — | `bot.setControlState(ctrl, bool)` | `player_input` |
| **Craft item** | `skills.craftRecipe(bot, name)` | skills.js | `bot.craft(recipe, count, table)` | `craft_recipe_request` |
| **Smelt item** | `skills.smeltItem(bot, name)` | skills.js | `bot.openFurnace(block)` | `click_window` |

---

## 5 · The Velocity Bug — Root Cause & Fix

```
minecraft-data (packet schema for 1.20.4):

  entity_velocity = {
    entityId: varint,
    velocity: vec3i16        ← decoded as NESTED object { x, y, z }
  }

Decoded packet arriving at mineflayer:
  { entityId: 42, velocity: { x: -626, y: 0, z: 0 } }

mineflayer/lib/plugins/entities.js (else-branch):
  entity.velocity = new Vec3(
    packet.velocityX / 8000,    ← packet.velocityX is UNDEFINED → NaN
    packet.velocityY / 8000,
    packet.velocityZ / 8000,
  )
  → entity.velocity = Vec3(NaN, NaN, NaN)

mineflayer/lib/plugins/physics.js (every tick):
  entity.position.add(entity.velocity)
  → position = Vec3(NaN, NaN, NaN)  ← bot freezes / desynchronises

──────────────────────────────────────────────────────
lib/velocityPatch.js FIX:

  bot._client.prependListener('entity_velocity', packet => {
    if (packet.velocity && !('velocityX' in packet)) {
      packet.velocityX = packet.velocity.x   // -626
      packet.velocityY = packet.velocity.y   // 0
      packet.velocityZ = packet.velocity.z   // 0
    }
  })

  ← prependListener = runs BEFORE entities.js handler
  ← modifies packet object in-place
  ← mineflayer then reads .velocityX correctly → ÷ 8000 → -0.078

  Same fix applied to 'spawn_entity' (includes initial velocity at spawn).

vec3i16 scale:  raw_i16 ÷ 8000 = blocks/tick
  -626 ÷ 8000 ≈ -0.078  (gravity pull)
   3360 ÷ 8000 =  0.42   (spawn bounce)
```

---

## 6 · Package Inventory

| Package | Version | Role | Who loads it |
|---------|---------|------|-------------|
| `mineflayer` | 4.37.0 | Minecraft client — bot API, 42 internal plugins, physics | `lib/createBotSession.js` |
| `minecraft-protocol` | 1.66.0 | Raw TCP: framing, encryption, compression, protodef codec | mineflayer (transitive) |
| `minecraft-data` | 3.109.0 | Version-specific block/item/entity/packet schemas | mcdata.js + mineflayer + mc-protocol |
| `mineflayer-pathfinder` | 2.4.5 | A* pathfinding, adds `bot.pathfinder.*` | `mc.init` via `bot.loadPlugin` |
| `mineflayer-collectblock` | 1.6.0 | Item pickup, adds `bot.collectBlock.*` | `mc.init` via `bot.loadPlugin` |
| `prismarine-item` | 1.18.0 | Item object (`new Item(id, count)`) | mcdata.js |
| `prismarine-viewer` | 1.33.0 | Browser 3D world renderer at `localhost:<port>` | `bot.js` on spawn (opt-in) |
| `canvas` | 3.x | Native C++ Canvas API (required by viewer) | prismarine-viewer (transitive) |
| `vec3` | 0.2.0 | 3D vector math | skills.js + mineflayer |

---

## 7 · Profiles at a Glance

| Profile | Viewer port | Triggers | Primary purpose |
|---------|-------------|---------|----------------|
| `sentinel` | 3000 | `playerRadius` | Break spawners + disconnect when player enters 3-block radius |
| `debug` | 3002 | `onSpawn` | Send `/skyblock` then print all nearby blocks + entities every 5 s |
| `trader` | 3001 | `onSpawn` + `blockNearby` + `playerRadius` | Warp to market → loot chest → sell → pick up drops; panic-disconnect on player |

Single bot:  `node bot.js sentinel` | `node bot.js debug` | `node bot.js trader`
Multi-bot:   `node orchestrator.js sentinel trader`  (auto-reconnect, shared EventBus)

---

## 8 · Extending the System

### New Action
1. `actions/myAction.js` → `async function myAction(bot, options, context) {}; module.exports = myAction`
   - `context` carries trigger data (e.g. `context.block`, `context.username`) — use or ignore as needed.
   - Read per-bot config via `bot._config` if you need profile settings.
   - Add `timeoutMs` to the action's `options` in a profile to abort the step after N ms via `Promise.race`.
2. Add `myAction: require('./myAction')` to registry in `actions/index.js`
3. Use `{ type: 'myAction', options: { timeoutMs: 30000, … } }` in a profile's `actions` array

### New Trigger
1. `triggers/myTrigger.js`:
   ```js
   function register(bot, options, fire) {
     const interval = setInterval(() => {
       if (someCondition) fire({ key: value })
     }, options.checkIntervalMs ?? 1000)
     return { cancel() { clearInterval(interval) } }  // ← required for session cleanup
   }
   module.exports = register
   ```
2. Add `myTrigger: require('./myTrigger')` to registry in `triggers/index.js`
3. In a profile: `{ type: 'myTrigger', priority: 5, options: { … }, actions: [ … ] }`
   - `priority` (number, optional, default 0): higher priority trigger chains run first
     among queued chains. Active chains run to completion before the next starts.

### New Profile
1. `profiles/myProfile.js` → spread `_base`, override what you need
2. Single bot: `node bot.js myProfile`
3. Multi-bot with reconnect: `node orchestrator.js myProfile sentinel`

### Cross-bot coordination via EventBus
```js
const EventBus = require('./lib/EventBus')
// In an action or trigger:
EventBus.emit('world:spawnerFound', { profile: bot._profileName, position: block.position })
// In orchestrator or a future GUI server:
EventBus.on('world:spawnerFound', ({ profile, position }) => { /* dispatch another bot */ })
```

### Important conventions
- Always use `world.*` or `skills.*` from `lib/` — never call mineflayer API directly from a
  trigger or action unless the API is trivial (`bot.chat`, `bot.quit`, `bot.setControlState`).
- Read per-bot config from `bot._config` — do not use `runtimeConfig.get()`.
- Every trigger handler must return `{ cancel() { … } }` so `stopAll()` can clean up on session end.
- Package manager is **pnpm** — do not mix with `npm install`.
- Use `node` to run scripts (`node bot.js`, `node orchestrator.js`) — pnpm is for package management only.

---

## 9 · Orchestration Layer — Detail

### Isolation guarantees

Each `createBotSession()` call produces a fully independent session:

| Resource | Isolation mechanism |
|----------|---------------------|
| mineflayer bot object | new `mineflayer.createBot()` per session |
| Profile config | `bot._config = profile` (no global singleton) |
| Action queue | `createTriggerRegistry()` returns a new queue per call |
| Trigger cleanup handles | `cleanups[]` array scoped to the factory closure |
| Process lifecycle | `promise` resolves/rejects; caller decides exit |
| `blockPlaceDelay` | `blockDelay(bot)` reads `bot._config` per-call |

### BotManager state transitions

```
              ┌──────────┐
  start() ──► │ CONNECTING│
              └─────┬────┘
                    │  login event
                    ▼
              ┌─────────┐
              │CONNECTED │  ◄── uptime timer starts
              └─────┬────┘
                    │  end / kick
                    ▼
              ┌────────────┐
              │DISCONNECTED│
              └─────┬──────┘
                    │
         ┌──────────┤
         │intentional│  stop() was called or bot._quitting=true at session end
         ▼          │
     ┌─────────┐    │  unexpected
     │ STOPPED │    ▼
     └─────────┘  ┌─────────────┐
                  │RECONNECTING │  delay = min(base × 2^attempt, 60 000 ms)
                  └──────┬──────┘
                         │
              ┌──────────┤
              │attempt > maxRetries
              ▼          │
          ┌────────┐     │ retry
          │ FAILED │     └──► CONNECTING
          └────────┘
```

### EventBus event catalogue

| Event name | Payload | Published by |
|------------|---------|--------------|
| `bot:stateChange` | `{ profile, state, attempt, uptime }` | orchestrator (forwards BotManager) |
| `bot:error` | `{ profile, error, attempt }` | orchestrator (forwards BotManager) |
| `bot:reconnecting` | `{ profile, attempt, delay }` | orchestrator (forwards BotManager) |

Future events (publish from actions/triggers, subscribe in orchestrator or GUI server):

| Event name | Payload | Intent |
|------------|---------|--------|
| `world:spawnerFound` | `{ profile, position }` | Notify another bot to assist |
| `world:playerSeen` | `{ profile, username, distance }` | Alert other bots |
| `trade:cycleComplete` | `{ profile, items, profit }` | Trigger re-supply bot |
| `inventory:full` | `{ profile }` | Dispatch carrier bot |

### Future GUI integration pattern

```
HTTP / WebSocket server (future)
  │
  ├─ GET  /bots        → orchestrator.getBotStates()        [initial render]
  ├─ POST /bots/:name/start  → orchestrator.spawnBot(cfg)
  ├─ POST /bots/:name/stop   → orchestrator.stopBot(name)
  │
  └─ WebSocket push ← EventBus.on('bot:stateChange', send)
                    ← EventBus.on('bot:error', send)
                    ← EventBus.on('world:*', send)   [game events]
```

The GUI server simply `require('./orchestrator')` and subscribes to `EventBus`. No changes
to bot sessions, BotManager, or profiles are needed when the GUI is added.
