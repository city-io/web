# CityIO Frontend

Strategy/city-building game frontend built with SvelteKit, Pixi.js, and Connect RPC.

## Tech Stack

- **Framework:** SvelteKit 2 + Vite 6 + TypeScript 5
- **Rendering:** Pixi.js 8 (2D WebGL hex grid)
- **RPC:** Connect RPC (`@connectrpc/connect-web`) with JWT auth interceptor
- **Protobuf:** Generated via `buf generate` (buf.build/bufbuild/es → TypeScript)
- **Styling:** Tailwind CSS 3
- **Build:** Static adapter (SPA mode, output to `build/`)

## Commands

- `yarn dev` — dev server
- `yarn build` — production build
- `yarn generate` — regenerate protobuf TypeScript from `proto/` using buf
- `npx svelte-check` — type checking
- `yarn lint` / `yarn format` — eslint + prettier

## Project Structure

```
src/
├── lib/
│   ├── api/
│   │   ├── transport.ts    # Connect RPC transport + JWT auth interceptor
│   │   └── client.ts       # Service client exports (user, city, building, map, config)
│   ├── game/
│   │   ├── hex.ts          # Hex grid math (flat-top, odd-q offset), coordinate conversion
│   │   ├── colors.ts       # Deterministic per-tile color variation, darken utility
│   │   ├── tiles.ts        # Pixi tile texture generation per TileKind (grass, fog, buildings)
│   │   └── rates.ts        # Rate/Duration proto → per-hour display numbers
│   ├── gen/cityio/         # Generated protobuf code, entity/v1 + service/v1 (DO NOT edit manually)
│   ├── session.ts          # clearSession, token validity check, 401 → /login handling
│   └── stores.ts           # Svelte stores (auth, resources, game config, map state)
├── routes/
│   ├── +page.svelte        # Home/landing page
│   ├── login/              # Login page
│   ├── register/           # Register page
│   └── game/
│       ├── +layout.svelte  # Loads map data, game config, starts resource stream
│       └── +page.svelte    # Main game: Pixi.js hex rendering, UI panels, building CRUD
proto/cityio/               # Protobuf definitions (mirrored from backend)
├── entity/v1/              # Typed IDs, enums, Coordinates, Rate, entities, EntityBag
└── service/v1/             # RPC request/response messages + service definitions
```

## Key Architecture

### Hex Grid (flat-top, odd-q offset)
- Tile size: `S = 50` (center-to-vertex, ~100px wide)
- Coordinate conversion in `src/lib/game/hex.ts`
- 3D effect: extruded side faces + directional lighting bevel on top face
- Fog of war: Chebyshev distance from owned city AABBs

### RPC Services
All defined in `proto/cityio/service/v1/` (package `cityio.service.v1`, so procedure names are
`/cityio.service.v1.UserService/Login` etc.):
- **ConfigService** — `GetGameConfig` (map size, vision radius, etc.)
- **UserService** — Register, Login, GetUser, StreamState (gold/food SSE)
- **CityService** — GetCity, CreateCity, ListCities
- **BuildingService** — CreateBuilding, UpgradeBuilding, DeleteBuilding
- **MapService** — GetMap (returns all visible cities + buildings)

### State Management
Svelte writable stores in `src/lib/stores.ts`:
- Auth stores (`token`, `userId`, `email`, `username`) are persisted to localStorage
- `gameConfig` — loaded from ConfigService on game layout mount
- `cities`, `buildings` — loaded from MapService
- `gold`, `food` — streamed via UserService.StreamState

### Environment
- `VITE_API_HOST` — backend URL (default: `https://api.cityio.prayujt.com`)
- `.env.development` sets `http://localhost:8080` for local dev

## Proto Generation

Proto files live in `proto/` and are a manual copy of the backend's — the backend repo is the
authoritative side, and nothing enforces that the two stay in sync. Regenerate after any proto
change:

```sh
# Copy the whole tree from the sibling backend checkout (entity/v1 + service/v1)
cp -R ../backend/proto/cityio/ proto/cityio/

# Verify they now match — this must print nothing
diff -r ../backend/proto proto

# Regenerate TypeScript into src/lib/gen/
yarn generate
```

Requires the `buf` CLI on `PATH` (tested with v1.69.0). Without it `yarn generate` fails with
`buf: command not found`, and the generated code silently keeps describing the old contract.

## Code Style

- Tabs for indentation (in Svelte/TS files)
- Single quotes, no trailing commas
- Print width: 200
- Prettier plugins: svelte, tailwindcss
