import { createClient } from '@connectrpc/connect';
import { transport } from './transport';
import { UserService } from '$lib/gen/cityio/v1/user_pb';
import { CityService } from '$lib/gen/cityio/v1/city_pb';
import { BuildingService } from '$lib/gen/cityio/v1/building_pb';
import { MapService } from '$lib/gen/cityio/v1/map_pb';

export const userClient = createClient(UserService, transport);
export const cityClient = createClient(CityService, transport);
export const buildingClient = createClient(BuildingService, transport);
export const mapClient = createClient(MapService, transport);
