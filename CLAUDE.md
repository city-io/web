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
│   │   └── colors.ts       # Deterministic per-tile color variation, darken utility
│   ├── gen/cityio/v1/      # Generated protobuf code (DO NOT edit manually)
│   └── stores.ts           # Svelte stores (auth, resources, game config, map state)
├── routes/
│   ├── +page.svelte        # Home/landing page
│   ├── login/              # Login page
│   ├── register/           # Register page
│   └── game/
│       ├── +layout.svelte  # Loads map data, game config, starts resource stream
│       └── +page.svelte    # Main game: Pixi.js hex rendering, UI panels, building CRUD
proto/cityio/v1/            # Protobuf definitions (mirrored from backend)
```

## Key Architecture

### Hex Grid (flat-top, odd-q offset)
- Tile size: `S = 50` (center-to-vertex, ~100px wide)
- Coordinate conversion in `src/lib/game/hex.ts`
- 3D effect: extruded side faces + directional lighting bevel on top face
- Fog of war: Chebyshev distance from owned city AABBs

### RPC Services
All defined in `proto/cityio/v1/`:
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

Proto files live in `proto/` and must match the backend (`cityio-backend/proto/`). To regenerate after proto changes:

```sh
# Copy updated protos from backend
cp ../cityio-backend/proto/cityio/v1/*.proto proto/cityio/v1/

# Regenerate TypeScript
buf generate
```

Requires `buf` CLI installed (tested with v1.69.0).

## Code Style

- Tabs for indentation (in Svelte/TS files)
- Single quotes, no trailing commas
- Print width: 200
- Prettier plugins: svelte, tailwindcss
