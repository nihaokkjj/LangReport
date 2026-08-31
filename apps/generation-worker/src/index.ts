const workerName = "generation-worker";

console.log(`${workerName} ready; queue adapter and Model Gateway are next.`);

setInterval(() => {
  console.log(`${workerName} waiting for Generation Jobs`);
}, 30_000);
