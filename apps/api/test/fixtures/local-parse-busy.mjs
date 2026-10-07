// Deliberately CPU bound; the parent test must terminate this worker.
while (true) {
  Math.sqrt(Math.random());
}
