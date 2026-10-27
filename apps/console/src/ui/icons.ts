/**
 * Every glyph the console draws, and the only module allowed to import the icon set (ESLint
 * `no-restricted-imports`), so swapping Lucide for another set changes this file alone.
 * Glyph choices follow the approved icon map in `docs/design/icons.md`.
 *
 * To add a glyph: import it here, then either map it to a domain value below or re-export it with
 * the generic UI glyphs at the bottom.
 */
import {
  Activity,
  ArrowUpDown,
  Ban,
  Battery,
  Biohazard,
  Building2,
  Car,
  CarFront,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleQuestionMark,
  Clock,
  CloudLightning,
  Cpu,
  Cross,
  Cylinder,
  DoorOpen,
  Droplet,
  Fan,
  Fence,
  FireExtinguisher,
  Flag,
  Flame,
  FlameKindling,
  Gauge,
  HandFist,
  HandGrab,
  HardHat,
  HeartPulse,
  Info,
  KeyRound,
  type LucideIcon,
  OctagonAlert,
  Package,
  Pause,
  Power,
  Radio,
  RefreshCw,
  Router,
  ServerOff,
  ShieldUser,
  Siren,
  SprayCan,
  SquareParking,
  Stethoscope,
  Thermometer,
  ThermometerSun,
  Tornado,
  TreeDeciduous,
  Trees,
  TriangleAlert,
  User,
  UserCheck,
  UserRoundSearch,
  Users,
  UtilityPole,
  Video,
  VideoOff,
  Volleyball,
  WavesArrowUp,
  WavesHorizontal,
  WifiOff,
  Wrench,
  Zap,
} from 'lucide-react';
import type {
  ActorKind,
  IncidentCategory,
  IncidentEventKind,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  ZoneKind,
} from '@occ/contracts';
import type { AssetState } from '../lib/assets/assets';
import type { TelemetryPillState } from '../lib/telemetry/telemetryState';
import type { ConnectionState } from '../store';

/** A drawable glyph. Consumers use this type, never the icon set's own. */
export type Glyph = LucideIcon;

// Each map is a `Record` over its union, so a value added to the contract fails `typecheck` here
// until it has a glyph. Data from a newer API can still carry a value this build's contract lacks
// (rolling deploys, ADR-0021): the type, category and zone-kind accessors fall back to
// `unknownIcon` for it rather than return `undefined`, which `Icon` cannot draw.

/** A domain value this console does not know. Never a glyph for a known value. */
export const unknownIcon: Glyph = CircleQuestionMark;

const SEVERITY_ICONS: Record<IncidentSeverity, Glyph> = {
  critical: OctagonAlert,
  high: TriangleAlert,
  medium: CircleAlert,
  low: Info,
};

export const severityIcon = (severity: IncidentSeverity) => SEVERITY_ICONS[severity];

// `Zap` and `Fan` are also generic twin glyphs (mains supply; fan, fan speed) with the same meaning:
// electric supply and air handling.
const INCIDENT_TYPE_ICONS: Record<IncidentType, Glyph> = {
  intrusion: DoorOpen,
  fire_alarm: Flame,
  equipment_fault: Wrench,
  medical: HeartPulse,
  crowding: Users,
  suspicious_object: Package,
  theft: HandGrab,
  vandalism: SprayCan,
  suspicious_person: UserRoundSearch,
  assault: HandFist,
  fire: FlameKindling,
  gas_leak: Cylinder,
  hazmat_spill: Biohazard,
  injury: Cross,
  power_outage: Zap,
  water_leak: Droplet,
  lift_entrapment: ArrowUpDown,
  hvac_fault: Fan,
  network_outage: ServerOff,
  severe_weather: Tornado,
  flooding: WavesArrowUp,
  fallen_tree: TreeDeciduous,
  traffic_accident: CarFront,
  blocked_access: Ban,
};

export const incidentTypeIcon = (type: IncidentType): Glyph =>
  INCIDENT_TYPE_ICONS[type] ?? unknownIcon;

// A category glyph is never a type glyph: the incident sheet shows both chips side by side.
const CATEGORY_ICONS: Record<IncidentCategory, Glyph> = {
  security: ShieldUser,
  fire_safety: FireExtinguisher,
  medical: Stethoscope,
  facilities: HardHat,
  environment: CloudLightning,
  traffic: Car,
};

export const categoryIcon = (category: IncidentCategory): Glyph =>
  CATEGORY_ICONS[category] ?? unknownIcon;

const STATUS_ICONS: Record<IncidentStatus, Glyph> = {
  open: CircleDot,
  acknowledged: UserCheck,
  resolved: CircleCheck,
};

export const statusIcon = (status: IncidentStatus) => STATUS_ICONS[status];

// Acknowledged and resolved share their status glyph: the timeline entry means the same thing.
const EVENT_KIND_ICONS: Record<IncidentEventKind, Glyph> = {
  reported: Flag,
  acknowledged: UserCheck,
  resolved: CircleCheck,
};

export const eventKindIcon = (kind: IncidentEventKind) => EVENT_KIND_ICONS[kind];

const ZONE_KIND_ICONS: Record<ZoneKind, Glyph> = {
  building: Building2,
  parking: SquareParking,
  gate: Fence,
  outdoor: Trees,
  sports: Volleyball,
  utility: UtilityPole,
  water: WavesHorizontal,
};

export const zoneKindIcon = (kind: ZoneKind): Glyph => ZONE_KIND_ICONS[kind] ?? unknownIcon;

const ACTOR_KIND_ICONS: Record<ActorKind, Glyph> = {
  user: User,
  system: Cpu,
};

export const actorKindIcon = (kind: ActorKind) => ACTOR_KIND_ICONS[kind];

// The first connect and a reconnect attempt share the refresh glyph: both are a link being made.
const CONNECTION_ICONS: Record<ConnectionState, Glyph> = {
  live: Radio,
  connecting: RefreshCw,
  reconnecting: RefreshCw,
  offline: WifiOff,
};

export const connectionIcon = (state: ConnectionState) => CONNECTION_ICONS[state];

// The `Telemetry` pill and its banner (V2-08.1). A link being made or lost reads as the Live pill's
// does; `live` and `paused` have glyphs of their own, as the frames draw them.
const TELEMETRY_ICONS: Record<TelemetryPillState, Glyph> = {
  connecting: CONNECTION_ICONS.connecting,
  live: Activity,
  paused: Pause,
  reconnecting: CONNECTION_ICONS.reconnecting,
  unavailable: CONNECTION_ICONS.offline,
};

export const telemetryIcon = (state: TelemetryPillState) => TELEMETRY_ICONS[state];

// An asset class and what it shares, by meaning (V2-09.4, docs/design/icons.md § Asset classes and
// states). A share is deliberate and has one meaning each: `Fan` air handling (also `hvac_fault`),
// `Zap` electric supply (also `power_outage`), `Power` a power source or switching, `Thermometer`
// temperature control (the cooling plants); `ArrowUpDown`, `Fence`, `Droplet` and `Cylinder` are the
// glyph of the incident type or zone kind that means the same (`lift_entrapment`, `gate`,
// `water_leak`, `gas_leak`).
//
// Not shared: `ThermometerSun`, ambient temperature measurement (`indoor_climate`, the direction's
// temperature sensor), so a sensor is not drawn as a cooling plant; and `Siren`, `KeyRound` and
// `Router`, one class each (V3-04.7).
//
// A class code is open data (a newer API can send one this build lacks) and the contract has no list
// of them, so unlike the maps above nothing fails `typecheck` for a class missing here: it draws
// `unknownIcon` until it is added. A `Map`, so a code such as `constructor` is not read off the
// object prototype.
const ASSET_CLASS_ICONS = new Map<string, Glyph>([
  ['cooling_tower', Fan],
  ['fume_hood', Fan],
  ['air_handler', Fan],
  ['ups', Zap],
  ['transformer', Zap],
  ['ups_battery', Battery],
  ['standby_generator', Power],
  ['switchgear', Power],
  ['precision_cooling', Thermometer],
  ['chiller', Thermometer],
  ['indoor_climate', ThermometerSun],
  ['lift', ArrowUpDown],
  ['barrier_arm', Fence],
  ['leak_sensor', Droplet],
  ['gas_detector', Cylinder],
  // Its headline point is the discharge pressure.
  ['booster_pump', Gauge],
  // The three classes of V3-A, mapped ahead of the seed (V3-04.7). The codes are proposals until
  // V3-A.1 fixes them; if one changes, this map follows or the class draws `unknownIcon`.
  ['smoke_detector', Siren],
  ['access_controller', KeyRound],
  ['network_gateway', Router],
]);

export const assetClassIcon = (classCode: string): Glyph =>
  ASSET_CLASS_ICONS.get(classCode) ?? unknownIcon;

/** The states of an asset that have a glyph of their own. */
type GlyphedAssetState = Exclude<AssetState, 'fault' | 'unknown'>;

// The list always draws the state word beside its glyph. `running` and `standby` share `Activity` and
// `Pause` with the telemetry pill's `live` and `paused`: a live signal and an operating asset, a
// paused feed and an asset on hold, told apart by the word next to them. `nodata` and `offline` share
// `Clock`: the same look, a different label (V2-08.1).
//
// Not here: `fault`, whose glyph is the severity glyph of its incident (`severityIcon`), which only
// the caller knows; and `unknown`, which has no state word and so no glyph.
const ASSET_STATE_ICONS: Record<GlyphedAssetState, Glyph> = {
  running: Activity,
  standby: Pause,
  nodata: Clock,
  offline: Clock,
};

export const assetStateIcon = (state: GlyphedAssetState): Glyph => ASSET_STATE_ICONS[state];

export const cameraIcon = (online: boolean): Glyph => (online ? Video : VideoOff);

// Generic UI glyphs, re-exported so that nothing outside this module imports the icon set.
// The map glyph is Lucide's `MapIcon` alias, so it does not shadow the global `Map` in consumers.
export {
  Activity,
  ArrowLeft,
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CircleX,
  Clock,
  Crosshair,
  Eye,
  Fan,
  Flag,
  Hand,
  House,
  Info,
  Keyboard,
  LoaderCircle,
  Lock,
  LogOut,
  MapIcon,
  MapPin,
  Maximize,
  Maximize2,
  Minus,
  Orbit,
  Pause,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  RotateCw,
  Rows3,
  Scan,
  Search,
  Shield,
  Thermometer,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
