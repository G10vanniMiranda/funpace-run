const expectedMajor = 22;
const actualMajor = Number.parseInt(process.versions.node.split('.')[0] || '', 10);

if (actualMajor !== expectedMajor) {
  console.error(`Node ${expectedMajor}.x is required; received ${process.versions.node}.`);
  process.exit(1);
}

console.log(`Node runtime validated: ${process.versions.node}`);
