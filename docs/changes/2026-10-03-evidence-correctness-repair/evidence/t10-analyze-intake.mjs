import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Recompute summaries from every supplied raw report; never select rounds.
for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  const report = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  const durations = report.rounds.map((round) => round.uploadMs).sort((a, b) => a - b);
  const latencies = report.rounds.flatMap((round) => round.latency);
  const reads = report.rounds.flatMap((round) => round.samples.filter((sample) => sample.path !== "/health"));
  console.log(
    JSON.stringify({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadMedianMs: durations[Math.floor(durations.length / 2)],
      maxExtraRssMiB: Math.max(...report.rounds.map((round) => round.extraRss)) / 1048576,
      maxHealthP95IncreaseMs: Math.max(
        ...latencies
          .filter((metric) => metric.path === "/health")
          .map((metric) => metric.uploadP95 - metric.baselineP95),
      ),
      maxReadP95IncreaseMs: Math.max(
        ...latencies
          .filter((metric) => metric.path !== "/health")
          .map((metric) => metric.uploadP95 - metric.baselineP95),
      ),
      maxReadInFlight: reads.every((sample) => Number.isFinite(sample.inFlightAtStart))
        ? Math.max(...reads.map((sample) => sample.inFlightAtStart))
        : null,
      clientErrors: report.rounds
        .flatMap((round) => [...round.baseline, ...round.samples])
        .filter((sample) => sample.status !== 200 || sample.error).length,
      serverTimingAvailable: Array.isArray(report.serverSamples),
      databaseTimingAvailable: Array.isArray(report.databaseSamples),
    }),
  );
}
