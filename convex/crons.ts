import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("ingest gdelt every 2 minutes", { minutes: 2 }, internal.ingest.ingestGdelt, {});
crons.interval("ingest firms every 5 minutes", { minutes: 5 }, internal.ingest.ingestFirms, {});
crons.interval(
  "ingest open-meteo every 12 minutes",
  { minutes: 12 },
  internal.ingest.ingestOpenMeteo,
  {},
);
crons.interval(
  "ingest satellite every 10 minutes",
  { minutes: 10 },
  internal.ingest.ingestSatellite,
  {},
);
crons.interval(
  "ingest seismic every 10 minutes",
  { minutes: 10 },
  internal.ingest.ingestSeismic,
  {},
);
crons.interval("ingest flights every 5 minutes", { minutes: 5 }, internal.ingest.ingestFlights, {});
crons.interval(
  "ingest aviation-weather every 10 minutes",
  { minutes: 10 },
  internal.ingest.ingestAviationWeather,
  {},
);
crons.interval(
  "ingest connectivity every 5 minutes",
  { minutes: 5 },
  internal.ingest.ingestConnectivity,
  {},
);
crons.interval("ingest power every 10 minutes", { minutes: 10 }, internal.ingest.ingestPower, {});
crons.interval(
  "ingest opensensemap every 15 minutes",
  { minutes: 15 },
  internal.ingest.ingestOpenSenseMap,
  {},
);
crons.interval(
  "ingest orbital every 60 minutes",
  { minutes: 60 },
  internal.ingest.ingestOrbital,
  {},
);

if ((process.env.ENABLE_SOCIAL_INGESTION ?? "false") === "true") {
  crons.interval(
    "ingest social every 5 minutes",
    { minutes: 5 },
    internal.ingest.ingestSocial,
    {},
  );
}

export default crons;
