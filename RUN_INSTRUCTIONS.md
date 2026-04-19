# MetaKing — Run Instructions

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| npm | 10+ |
| Docker | 24+ (for local Postgres) |
| Unity | 6 LTS (6000.x) |
| Xcode | 15+ (for iOS build) |

---

## 1. Database Setup (Docker — recommended)

A `docker-compose.yml` is included in `server/`. It starts Postgres 16 and
auto-creates both the `metaking` and `metaking_test` databases.

```bash
cd server
npm run db:up        # pulls postgres:16-alpine and starts it (waits for healthy)
```

To stop: `npm run db:down`  
To wipe all data and start fresh: `npm run db:reset`

### Option B — Local PostgreSQL (if you prefer not to use Docker)

```bash
# macOS with Homebrew
brew install postgresql@16
brew services start postgresql@16
createdb metaking
createdb metaking_test
```

Then set `DATABASE_URL` and `TEST_DATABASE_URL` in `.env` to point at your local instance.

---

## 2. Backend Setup

```bash
cd server
cp .env.example .env     # credentials already match the Docker compose defaults
npm install
```

### .env values (defaults match Docker)

```
DATABASE_URL=postgresql://metaking:password@localhost:5432/metaking
TEST_DATABASE_URL=postgresql://metaking:password@localhost:5432/metaking_test
JWT_SECRET=change_this_to_a_long_random_string_at_least_32_chars
REVENUECAT_SECRET_KEY=your_revenuecat_secret
PORT=3000
```

### Run database migration

```bash
npm run migration:up
```

This runs `Migration001_initial.ts` which creates:
- `players`, `bots`, `portals`, `messages` tables + all indexes

### Seed bots (10,000 bots — run once)

```bash
npm run seed:bots
```

Takes ~30 seconds. Safe to re-run — skips if bots already present.

### Run tests

```bash
npm test             # unit tests only (no DB required)
npm run test:db      # starts Docker Postgres, migrates both DBs, runs all 30 tests
```

### Start server

```bash
npm run dev                   # ts-node-dev, hot reload
# or
npm run build && npm start    # production
```

Server starts on `http://localhost:3000`.  
Bot cron runs every hour automatically.

### Health check

```bash
curl http://localhost:3000/health
# → {"ok":true}
```

### Available npm scripts

```
npm run dev              — hot-reload dev server
npm run build            — compile TypeScript → dist/
npm start                — run compiled dist/server.js
npm test                 — Jest unit tests (no DB)
npm run test:db          — start Docker DB + run all 30 tests
npm run db:up            — start Dockerised Postgres (waits for healthy)
npm run db:down          — stop Postgres container
npm run db:reset         — wipe volumes, restart, re-migrate
npm run db:migrate       — run migrations on both main and test DBs
npm run migration:up     — run pending MikroORM migrations (uses DATABASE_URL)
npm run migration:create — scaffold new migration
npm run seed:bots        — seed 10,000 bot players
```

---

## 3. Unity Client Setup

### 3.1 Open project

1. Open **Unity Hub**
2. Click **Add → Add project from disk**
3. Select `metaking/client/`
4. Open with **Unity 6 LTS** (6000.x)

### 3.2 Install packages (via Window → Package Manager)

| Package | Version |
|---------|---------|
| Universal Render Pipeline | 17.x |
| Cinemachine | 3.x |
| TextMeshPro | 3.x |
| Input System | 1.8.x |
| AI Navigation (NavMesh) | 2.x |

> Unity will prompt to enable the new Input System backend — click **Yes** and let it restart.

### 3.3 Third-party SDKs (import .unitypackage or via OpenUPM)

**Sign in with Apple** (by lupidan)
- GitHub: `https://github.com/lupidan/apple-signin-unity`
- Import `AppleAuth.unitypackage`

**RevenueCat**
- Download from `https://github.com/RevenueCat/purchases-unity/releases`
- Import `RevenueCat.unitypackage`
- Set your API key in `SubscriptionManager` → Inspector field **Revenue Cat Api Key**
  (or edit `client/Assets/Scripts/Subscriptions/SubscriptionManager.cs` line with `appl_REPLACE_WITH_YOUR_KEY`)

### 3.4 Input Actions asset

1. In Project window: `Assets/Settings/` → right-click → **Create → Input Actions**
2. Name it `PlayerInputActions`
3. Open it, add **Player** action map with:
   - `Move` — Value, Vector2, WASD + left stick + touch delta
   - `Dodge` — Button, Space + gamepad South
4. Enable **Generate C# Class**, set class name `PlayerInputActions`
5. Click **Apply** — Unity will regenerate the C# wrapper
6. Delete `Assets/Scripts/Player/PlayerInputActions.cs` (the stub) — the generated one replaces it

### 3.5 Configure API URL

In `client/Assets/Scripts/Api/ApiClient.cs`:
- Development: `baseUrl = "http://localhost:3000"` (edit the serialized field or Inspector)
- Production: set to your deployed server URL

### 3.6 Scene setup

**Bootstrap scene** (index 0):
- Create empty `Bootstrap` scene
- Add `BootstrapController` GameObject — assign prefab references in Inspector
- Add `OnboardingFlow` GameObject — wire all UI references
- Add UI: Sign-in panel, NicknamePanel, PaywallPanel, loading spinner

**Game scene** (index 1):
- Terrain: plane 500×500, NavMesh baked on it
- Player GameObject:
  - `CharacterController` (radius 0.5, height 1.8)
  - `PlayerVitals`, `PlayerController`, `PlayerCombat`, `PlayerWeapon`
  - Tag: `Player`
- Main Camera with Cinemachine Virtual Camera following player
  - Lens: FOV 60, Body: Transposer offset (0, 18, -12)
- Minimap Camera (orthographic, top-down) + `MinimapController` component
- `WarlockSpawnManager` (assign WarlockGroup prefab, Camera)
- `PortalManager` (assign Portal prefab, 3 spawn positions)
- `GameManager` (assign all scene refs)
- HUD Canvas (Screen Space — Camera)
- `ToastMessage` on canvas
- 8× `HeartPickup` spread around map

**Warlock Prefab:**
- Capsule mesh (low-poly, dark material)
- `NavMeshAgent` (speed 4, stopping distance 1.5)
- `WarlockAI` component
- Child GameObject with `SphereCollider` (trigger, radius 1.2) + `WarlockHitTrigger`
- Layer: `Warlock`

**Portal Prefab:**
- Cylinder mesh with emissive material
- `SphereCollider` (trigger, radius 2)
- `Portal` component (assign particle systems, renderer)

### 3.7 Build for iOS

1. **File → Build Settings → iOS → Switch Platform**
2. **Player Settings:**
   - Bundle ID: `gg.ludex.metaking` (or your own)
   - Signing: your Apple Developer team
   - Capabilities: **Sign in with Apple** ✓, **In-App Purchase** ✓
3. Click **Build** → open `.xcodeproj` in Xcode → Archive → TestFlight

---

## 4. Running Tests in Unity

1. **Window → General → Test Runner**
2. Select **EditMode** tab
3. Click **Run All**

Tests in `Assets/Tests/EditMode/`:
- `PlayerVitalsTests` — 14 tests covering all vital logic
- `WeaponTierTests` — 11 tests covering tier thresholds

---

## 5. Production Deployment

The server is a standard Express app — any Node-capable host works:

**Fly.io (recommended, cheap):**
```bash
cd server
fly launch          # follow prompts
fly secrets set DATABASE_URL="..." JWT_SECRET="..."
fly deploy
```

**Railway / Render / DigitalOcean App Platform** — all work the same way,  
just point `DATABASE_URL` to a managed Postgres instance.

After deploying:
1. Run `npm run migration:up` against production DB (set DATABASE_URL env var)
2. Run `npm run seed:bots` once against production DB
3. Update `ApiClient.cs` `baseUrl` to your production URL and rebuild Unity

---

## 6. Key Configuration

All tuneable game values live in **one file**:

```
server/src/config/constants.ts    ← server source of truth
client/Assets/Scripts/Config/GameConstants.cs  ← client defaults (overridden by /player/me at runtime)
```

Constants are served from `GET /player/me` → `constants` field and loaded into
`GameConstants.Data` at session start, so you never need to redeploy the Unity
client to tweak gameplay values.
