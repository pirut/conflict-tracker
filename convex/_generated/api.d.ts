/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as ingest from "../ingest.js";
import type * as ingestion_adapters_connectivity from "../ingestion/adapters/connectivity.js";
import type * as ingestion_adapters_firms from "../ingestion/adapters/firms.js";
import type * as ingestion_adapters_flights from "../ingestion/adapters/flights.js";
import type * as ingestion_adapters_gdelt from "../ingestion/adapters/gdelt.js";
import type * as ingestion_adapters_index from "../ingestion/adapters/index.js";
import type * as ingestion_adapters_shared from "../ingestion/adapters/shared.js";
import type * as ingestion_adapters_social from "../ingestion/adapters/social.js";
import type * as ingestion_types from "../ingestion/types.js";
import type * as ingestionPipeline from "../ingestionPipeline.js";
import type * as lib_categorize from "../lib/categorize.js";
import type * as lib_clustering from "../lib/clustering.js";
import type * as lib_confidence from "../lib/confidence.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_text from "../lib/text.js";
import type * as types from "../types.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  constants: typeof constants;
  crons: typeof crons;
  events: typeof events;
  ingest: typeof ingest;
  "ingestion/adapters/connectivity": typeof ingestion_adapters_connectivity;
  "ingestion/adapters/firms": typeof ingestion_adapters_firms;
  "ingestion/adapters/flights": typeof ingestion_adapters_flights;
  "ingestion/adapters/gdelt": typeof ingestion_adapters_gdelt;
  "ingestion/adapters/index": typeof ingestion_adapters_index;
  "ingestion/adapters/shared": typeof ingestion_adapters_shared;
  "ingestion/adapters/social": typeof ingestion_adapters_social;
  "ingestion/types": typeof ingestion_types;
  ingestionPipeline: typeof ingestionPipeline;
  "lib/categorize": typeof lib_categorize;
  "lib/clustering": typeof lib_clustering;
  "lib/confidence": typeof lib_confidence;
  "lib/geo": typeof lib_geo;
  "lib/text": typeof lib_text;
  types: typeof types;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
