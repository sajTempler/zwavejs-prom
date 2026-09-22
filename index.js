// Simple zwavejs2mqtt plugin for prometheus metrics

import { Registry, Gauge, register } from '@prometheus-io/client'

const labelNames = [
    'nodeId',
    'location',
    'name',
    'commandClass',
    'property',
    'propertyKey',
    'label',
    'endpoint',
    'id',
    'state'
]

function shallowEquals(a, b) {
    for (const key in a) {
        if (!(key in b) || a[key] !== b[key]) {
            return false;
        }
    }
    for (const key in b) {
        if (!(key in a)) {
            return false;
        }
    }
    return true;
}

function isDefined(a) {
    return a !== undefined && a !== null
}

function getOrDefault(dict, id, func) {
    let v = dict[id]
    if (!isDefined(v)) {
        v = func()
        dict[id] = v
    }

    return v
}

function zwaveLabel(label) {
    return label.toString()
        .toLowerCase()
        .replaceAll(' ', '_')
        .replaceAll('₂', '2') // special case for co2
        .replaceAll(/[^a-zA-Z0-9_]/ig, '') // Remove all non-allowed letters (see https://prometheus.io/docs/concepts/data_model/#metric-names-and-labels)
}

export default class ZwavejsProm {
    constructor(ctx) {
        this.zwave = ctx.zwave
        this.mqtt = ctx.mqtt
        this.logger = ctx.logger
        this.app = ctx.app

        this.logger.info('Starting ZwaveJS prom plugin')

        this.registry = new Registry()
        this.gauges = {}
        this.nodes = {}

        this.zwave.on('valueChanged', this.onValueChanged.bind(this))
        this.zwave.on('nodeRemoved', this.onNodeRemoved.bind(this))
        this.zwave.on('nodeStatus', this.onNodeStatus.bind(this))

        this.app.get('/metrics', this.sendMetrics.bind(this))
    }

    async destroy() {
        this.logger.info('Stopping ZwaveJS prom plugin')
    }

    async sendMetrics(req, res) {
        res.set('Content-Type', this.registry.contentType || register.contentType)
        const metrics = await this.registry.metrics()
        res.send(metrics)
    }

    onNodeRemoved(node) {
        //this.logger.info(`Node removed: ${JSON.stringify(node)}`)

        const id = node.id.toString()
        const n = this.nodes[id]
        if (isDefined(n)) {
            for (const v of Object.values(n.values)) {
                v.gauge.remove(v.labels)
            }

            delete this.nodes[id]
        }
    }

    onNodeStatus(node) {
        //this.logger.info(`Node status updated: ${JSON.stringify(node)}`)
        this.updateNode(node)
    }

    updateNode(node) {
        const n = getOrDefault(this.nodes, node.id.toString(), () => ({
            values: {},
            name: node.name,
            location: node.loc
        }))

        if (n.name !== node.name || n.location !== node.loc) {
            this.updateNameAndLocation(n, node.name, node.loc)
        }

        return n
    }

    onValueChanged(value) {
        //this.logger.info(`Value changed: ${JSON.stringify(value)}`)

        // skip command classes making no sense to monitor
        switch (value.commandClass) {
            case 0x70: // Configuration
            case 0x72: // Manufacturer specific
            case 0x86: // Version
            case 0x60: // Multi Channel
                return
        }

        // skip non-readable values
        if (!value.readable) {
            return
        }

        const states = {}
        if (value.list) {
            for (const s of value.states) {
                states[s.value] = s.text
            }
        }

        let v = value.value
        if (v === undefined && states[0] === 'idle') {
            v = 0
        }

        let metricValue = 0
        switch (typeof v) {
            case 'number':
                metricValue = v
                break
            case 'boolean':
                if (v) {
                    metricValue = 1
                }
                break
            default:
                return
        }

        const z2mNode = this.zwave.nodes.get(value.nodeId)

        let gaugeName = `zwave_${zwaveLabel(value.commandClassName)}_${zwaveLabel(value.property)}`
        let gaugeHelp = `Zwave, ${value.commandClassName}, ${value.propertyName}`

        const labels = {
            nodeId: value.nodeId,
            name: z2mNode.name,
            location: z2mNode.loc,
            commandClass: value.commandClassName,
            property: value.property,
            label: value.label,
            endpoint: value.endpoint,
            id: value.id
        }

        if (isDefined(value.propertyKey)) {
            labels.propertyKey = value.propertyKey
            gaugeName = `${gaugeName}_${zwaveLabel(value.propertyKey)}`
            gaugeHelp = `${gaugeHelp}, ${value.propertyKeyName}`
        }

        const state = states[v]
        if (isDefined(state)) {
            labels.state = state
        }

        const node = this.updateNode(z2mNode)

        //this.logger.info(`value: ${JSON.stringify(value)}`)
        //this.logger.info(`gaugeName: ${gaugeName}, gaugeHelp: ${gaugeHelp}`)

        const gauge = getOrDefault(this.gauges, gaugeName, () =>
            new Gauge({
                registers: [this.registry],
                name: gaugeName,
                help: gaugeHelp,
                labelNames: labelNames
            }))

        const nodeValue = getOrDefault(node.values, value.id, () => ({
            labels: labels,
            value: metricValue,
            gauge: gauge
        }))

        if (!shallowEquals(labels, nodeValue.labels)) {
            gauge.remove(nodeValue.labels)
        }

        gauge.set(labels, metricValue)

        nodeValue.labels = labels
        nodeValue.value = metricValue
    }

    updateNameAndLocation(node, name, loc) {
        for (const v of Object.values(node.values)) {
            v.gauge.remove(v.labels)

            v.labels.name = name
            v.labels.location = loc

            v.gauge.set(v.labels, v.value)
        }

        node.name = name
        node.location = loc
    }
}
