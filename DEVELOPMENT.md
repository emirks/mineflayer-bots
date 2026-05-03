To-Do's and features to add:


- [x] A good logging system
  - [x] Per-bot file output → `logs/<profileName>.log` (timestamped, plain text)
  - [x] Coloured console output — bot name tag colour-coded per bot (multi-bot readable)
  - [x] Session separators in log file on each connect/reconnect attempt
  - [x] Spawn state snapshot: position, health, food
  - [x] State transition logs: IDLE → CONNECTING → CONNECTED → DISCONNECTED → RECONNECTING…
  - [x] All triggers, actions, and session events use `bot.log.*` (no bare console.* left)
  - [x] Log in-game chat messages received from the server
  - [x] Log snapshots periodically while connected

- [x] Health check every interval (5mins now) so user knows bot is healthy.


- [x] Multi-bot system
  - [x] Add dynamic profile selection for orchestrator, instead of taking as an argument, make it ask when it opens up.
  - [ ] Inter-bot communication or orchestration (e.g. complementary spawner sets; intruder warns other bot)


### Order & Auction Bot
- [ ] Logging
  - [x] Log money/min for last minute too. One averaged and one for last min

- [ ] Smart trading mechanism
  - [ ] Make a research on the nice mechanism
  - [ ] Evaluate the current mechanism
  - [ ] How to place auctions?
  - [ ] Auto-withdraw Auctions?

- [x] Send the money gained after a threshold to our main user with "/pay nickname 13M" ragularly.
  - [x] Get the money earned with /bal command, not sum up manually! Check the summing mechanism against that!
- [x] Auto-Disconnect and Reconnect within an interval, wait some time for the market to stabilize? or handle this in the smart trading mechanism? Because now we disrupt it.

- [ ] Integrate donut.auction or donut flip api! Reason on how to use that!

- [ ] If no item is sold in like 3 mins, retreat all the items from the auction.



### Sentinel: 
  - [x] Define base first; normal behavior near base, freeze actions away from base (maintenance / player gathers)
      - [x] Start with a very basic implementation, like accepting the spawn position as the base and +- 30 blocks each direction
      - [x] ** Make it log once when out and once when went in!
      - [ ] Future: make this base position editable.
      - [x] Fix: Panic is not disabled bcs its not an action, no fire wrapper, do a check for it!
  - [x] Add a whitelist, no alert or panic for those users!
  - [x] Future: Add blacklist, direct alert=panic for those users
  - [x] Log the number of spawners we have in front periodically. Add position of spawners? 
  - [x] A stable spawner-breaking mechanism
  - [x] Can we access block stack sizes? Log stack counts during the 5‑minute health check too. (Possible — see debug profile and `logSpawnerData` action.) Follow `skills.js` / `world.js` patterns and best practice.
  - [x] Place a lower limit on inventory spawner count. Don't quit without gathering N number of Spawners
    - [x] Configurable manually
    - [x] When the count can be resolved, use the value from the latest check
  
### Spawner Bone Dropper
  - [x] Log everything, debugSpawnerWindow! 
  - [x] Implement Bone Dropping & Selling Mechanism
  - [ ] Implement throttling mechanism. N_bones/min

- [ ] Advanced: structure snapshot and auto-build
  - [ ] Research building sketches & schemas

- [ ] AFK avoidance - random movements etc

- [ ] Handle non-intentional disconnection logic like closing viewer

