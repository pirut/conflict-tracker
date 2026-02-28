import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("ingest gdelt every 2 minutes", { minutes: 2 }, internal.ingest.ingestGdelt, {});
crons.interval("ingest firms every 5 minutes", { minutes: 5 }, internal.ingest.ingestFirms, {});
crons.interval("ingest flights every 5 minutes", { minutes: 5 }, internal.ingest.ingestFlights, {});
crons.interval(
  "ingest connectivity every 5 minutes",
  { minutes: 5 },
  internal.ingest.ingestConnectivity,
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
