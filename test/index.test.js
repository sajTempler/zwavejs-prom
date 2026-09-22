import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import EventEmitter from 'node:events'
import ZwavejsProm from '../index.js'

function createMockContext() {
    const zwave = new EventEmitter()
    zwave.nodes = new Map()

    const mqtt = {}
    const logger = {
        info: () => {},
        warn: () => {},
        error: () => {}
    }

    const routes = {}
    const app = {
        get: (path, handler) => {
            routes[path] = handler
        }
    }

    return { zwave, mqtt, logger, app, routes }
}

describe('ZwavejsProm', () => {
    it('initializes listeners and /metrics route', () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        assert.equal(typeof ctx.routes['/metrics'], 'function')
        assert.equal(ctx.zwave.listenerCount('valueChanged'), 1)
        assert.equal(ctx.zwave.listenerCount('nodeRemoved'), 1)
        assert.equal(ctx.zwave.listenerCount('nodeStatus'), 1)
    })

    it('records numeric values and exposes them via /metrics', async () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        ctx.zwave.nodes.set(2, {
            id: 2,
            name: 'Living Room Sensor',
            loc: 'Living Room'
        })

        ctx.zwave.emit('valueChanged', {
            nodeId: 2,
            commandClass: 49,
            commandClassName: 'Multilevel Sensor',
            property: 'Air temperature',
            propertyName: 'Air temperature',
            label: 'Temperature',
            endpoint: 0,
            id: '2-49-0-Air temperature',
            readable: true,
            value: 21.5
        })

        let sentContentType = ''
        let sentBody = ''
        const mockRes = {
            set: (header, value) => {
                if (header === 'Content-Type') {
                    sentContentType = value
                }
            },
            send: (body) => {
                sentBody = body
            }
        }

        await ctx.routes['/metrics']({}, mockRes)

        assert.ok(sentContentType.length > 0)
        assert.ok(sentBody.includes('zwave_multilevel_sensor_air_temperature{'))
        assert.ok(sentBody.includes('nodeId="2"'))
        assert.ok(sentBody.includes('name="Living Room Sensor"'))
        assert.ok(sentBody.includes('location="Living Room"'))
        assert.ok(sentBody.includes(' 21.5'))
    })

    it('records boolean values as 0 and 1', async () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        ctx.zwave.nodes.set(3, { id: 3, name: 'Switch', loc: 'Hallway' })

        ctx.zwave.emit('valueChanged', {
            nodeId: 3,
            commandClass: 37,
            commandClassName: 'Binary Switch',
            property: 'currentValue',
            propertyName: 'Current Value',
            label: 'Switch State',
            endpoint: 0,
            id: '3-37-0-currentValue',
            readable: true,
            value: true
        })

        const metrics1 = await plugin.registry.metrics()
        assert.ok(metrics1.includes(' 1'))

        ctx.zwave.emit('valueChanged', {
            nodeId: 3,
            commandClass: 37,
            commandClassName: 'Binary Switch',
            property: 'currentValue',
            propertyName: 'Current Value',
            label: 'Switch State',
            endpoint: 0,
            id: '3-37-0-currentValue',
            readable: true,
            value: false
        })

        const metrics2 = await plugin.registry.metrics()
        assert.ok(metrics2.includes(' 0'))
    })

    it('handles list values and states', async () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        ctx.zwave.nodes.set(4, { id: 4, name: 'Smoke Detector', loc: 'Kitchen' })

        ctx.zwave.emit('valueChanged', {
            nodeId: 4,
            commandClass: 113,
            commandClassName: 'Notification',
            property: 'Smoke Alarm',
            propertyName: 'Smoke Alarm',
            label: 'Alarm Status',
            endpoint: 0,
            id: '4-113-0-Smoke Alarm',
            readable: true,
            list: true,
            states: [
                { value: 0, text: 'idle' },
                { value: 1, text: 'smoke detected' }
            ],
            value: 1
        })

        const metrics = await plugin.registry.metrics()
        assert.ok(metrics.includes('state="smoke detected"'))
        assert.ok(metrics.includes(' 1'))
    })

    it('appends propertyKey to metric name and labels', async () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        ctx.zwave.nodes.set(5, { id: 5, name: 'Thermostat', loc: 'Bedroom' })

        ctx.zwave.emit('valueChanged', {
            nodeId: 5,
            commandClass: 49,
            commandClassName: 'Multilevel Sensor',
            property: 'CO₂',
            propertyName: 'Carbon dioxide',
            propertyKey: 'level',
            propertyKeyName: 'Level',
            label: 'CO2 Level',
            endpoint: 1,
            id: '5-49-1-CO₂-level',
            readable: true,
            value: 650
        })

        const metrics = await plugin.registry.metrics()
        assert.ok(metrics.includes('zwave_multilevel_sensor_co2_level{'))
        assert.ok(metrics.includes('propertyKey="level"'))
        assert.ok(metrics.includes(' 650'))
    })

    it('skips non-readable and ignored command classes', async () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        ctx.zwave.nodes.set(6, { id: 6, name: 'Test Node', loc: 'Test' })

        // Ignored command class: 0x70 (Configuration)
        ctx.zwave.emit('valueChanged', {
            nodeId: 6,
            commandClass: 0x70,
            commandClassName: 'Configuration',
            property: 'param1',
            propertyName: 'Parameter 1',
            label: 'Param 1',
            endpoint: 0,
            id: '6-112-0-param1',
            readable: true,
            value: 10
        })

        // Non-readable value
        ctx.zwave.emit('valueChanged', {
            nodeId: 6,
            commandClass: 49,
            commandClassName: 'Multilevel Sensor',
            property: 'unreadable',
            propertyName: 'Unreadable',
            label: 'Unreadable',
            endpoint: 0,
            id: '6-49-0-unreadable',
            readable: false,
            value: 10
        })

        const metrics = await plugin.registry.metrics()
        assert.equal(metrics.trim(), '')
    })

    it('updates node name and location on nodeStatus', async () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        ctx.zwave.nodes.set(7, { id: 7, name: 'Old Name', loc: 'Old Loc' })

        ctx.zwave.emit('valueChanged', {
            nodeId: 7,
            commandClass: 49,
            commandClassName: 'Multilevel Sensor',
            property: 'humidity',
            propertyName: 'Humidity',
            label: 'Humidity',
            endpoint: 0,
            id: '7-49-0-humidity',
            readable: true,
            value: 45
        })

        let metrics = await plugin.registry.metrics()
        assert.ok(metrics.includes('name="Old Name"'))
        assert.ok(metrics.includes('location="Old Loc"'))

        // Update node status with new name and location
        ctx.zwave.emit('nodeStatus', { id: 7, name: 'New Name', loc: 'New Loc' })

        metrics = await plugin.registry.metrics()
        assert.ok(!metrics.includes('name="Old Name"'))
        assert.ok(metrics.includes('name="New Name"'))
        assert.ok(metrics.includes('location="New Loc"'))
        assert.ok(metrics.includes(' 45'))
    })

    it('removes metric series when node is removed', async () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        ctx.zwave.nodes.set(8, { id: 8, name: 'Temp Sensor', loc: 'Attic' })

        ctx.zwave.emit('valueChanged', {
            nodeId: 8,
            commandClass: 49,
            commandClassName: 'Multilevel Sensor',
            property: 'temperature',
            propertyName: 'Temperature',
            label: 'Temperature',
            endpoint: 0,
            id: '8-49-0-temperature',
            readable: true,
            value: 18.2
        })

        let metrics = await plugin.registry.metrics()
        assert.ok(metrics.includes('zwave_multilevel_sensor_temperature{'))

        // Remove node
        ctx.zwave.emit('nodeRemoved', { id: 8 })

        metrics = await plugin.registry.metrics()
        assert.ok(!metrics.includes('zwave_multilevel_sensor_temperature{'))
    })

    it('cleans up old labels when label values change', async () => {
        const ctx = createMockContext()
        const plugin = new ZwavejsProm(ctx)

        ctx.zwave.nodes.set(9, { id: 9, name: 'Motion Sensor', loc: 'Garage' })

        ctx.zwave.emit('valueChanged', {
            nodeId: 9,
            commandClass: 113,
            commandClassName: 'Notification',
            property: 'Motion',
            propertyName: 'Motion',
            label: 'Motion Status',
            endpoint: 0,
            id: '9-113-0-Motion',
            readable: true,
            list: true,
            states: [
                { value: 0, text: 'idle' },
                { value: 8, text: 'motion detected' }
            ],
            value: 8
        })

        let metrics = await plugin.registry.metrics()
        assert.ok(metrics.includes('state="motion detected"'))

        // Now value changes to idle
        ctx.zwave.emit('valueChanged', {
            nodeId: 9,
            commandClass: 113,
            commandClassName: 'Notification',
            property: 'Motion',
            propertyName: 'Motion',
            label: 'Motion Status',
            endpoint: 0,
            id: '9-113-0-Motion',
            readable: true,
            list: true,
            states: [
                { value: 0, text: 'idle' },
                { value: 8, text: 'motion detected' }
            ],
            value: 0
        })

        metrics = await plugin.registry.metrics()
        assert.ok(!metrics.includes('state="motion detected"'), 'Old label series should be removed')
        assert.ok(metrics.includes('state="idle"'), 'New label series should be present')
    })
})
