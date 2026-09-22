# zwavejs2mqtt plugin for prometheus metrics

Prometheus metrics exporter plugin for [zwavejs2mqtt](https://github.com/zwave-js/zwavejs2mqtt).

## Features

- Uses official [`@prometheus-io/client`](https://github.com/prometheus/client_js).
- Metrics exposed at `http://<your-zwavejs2mqtt-instance>/metrics`.
- Boolean metrics exposed as 0/1 values.
- List metrics exposed with state labels similar to [StateSet](https://github.com/OpenObservability/OpenMetrics/blob/main/specification/OpenMetrics.md#StateSet).
- Automatic metric series cleanup on node removal, node renaming, or label updates.

## Development

This repository uses [mise](https://mise.jdx.dev) to manage Node.js and pnpm versions.

### Prerequisites

- [mise](https://mise.jdx.dev) (or Node.js >= 22 and pnpm >= 10)

### Setup

```bash
# Install tools via mise
mise install

# Install dependencies
pnpm install
```

### Running Tests

Run the test suite using Node's native test runner:

```bash
pnpm test
```
