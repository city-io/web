import { createClient } from '@connectrpc/connect';
import { transport } from './transport';
import { UserService } from '$lib/gen/cityio/service/v1/user_pb';
import { CityService } from '$lib/gen/cityio/service/v1/city_pb';
import { BuildingService } from '$lib/gen/cityio/service/v1/building_pb';
import { MapService } from '$lib/gen/cityio/service/v1/map_pb';
import { ConfigService } from '$lib/gen/cityio/service/v1/config_pb';
import { ArmyService } from '$lib/gen/cityio/service/v1/army_pb';
import { MailboxService } from '$lib/gen/cityio/service/v1/mailbox_pb';

export const userClient = createClient(UserService, transport);
export const cityClient = createClient(CityService, transport);
export const buildingClient = createClient(BuildingService, transport);
export const mapClient = createClient(MapService, transport);
export const configClient = createClient(ConfigService, transport);
export const armyClient = createClient(ArmyService, transport);
export const mailboxClient = createClient(MailboxService, transport);
