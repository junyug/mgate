const test = require('ava')
const sinon = require('sinon')
const express = require('express')
const pify = require('pify')
const option = require('../lib/util/option')
const proxy = pify(require('../lib/proxy'))

let app
let server
let remote

test.cb.before(t => {
  app = express()
  app.use('/api/:r', (req, res) => res.end(`[${req.method}]${req.params.r}`))
  server = app.listen(0, 'localhost', () => {
    remote = `http://localhost:${server.address().port}`
    t.end()
  })
})

test.after.always(t => {
  server.close()
})

test('proxy single request', async t => {
  t.plan(3)

  await proxy({
    xxx: {
      url: `${remote}/api/xxx`,
      method: 'get',
    }
  }).then(result => t.deepEqual(result, { xxx: '[GET]xxx' }))

  const error = await t.throws(proxy({
    xxx: {
      url: `${remote}/error_api/xxx`,
      method: 'get',
    }
  }))

  t.is(error.status, 404)
})

test('use when function to switch a request', async t => {
  t.plan(4)

  await proxy({
    x1:{
      url: `${remote}/api/x1`,
      method: 'get',
      when() { return true }
    },
    x2:{
      url: `${remote}/api/x2`,
      method: 'get',
      when() { return Promise.resolve(false) }
    }
  }).then(result => {
    t.deepEqual(result, { x1: '[GET]x1' })
    t.notDeepEqual(result, { x1: '[GET]x1', x2: '[GET]x2' })
  })

  await t.throws(proxy({
    xxx: {
      url: `${remote}/api/xxx`,
      method: 'get',
      when() {
        throw new Error('throw')
      }
    }
  }))

  await t.throws(proxy({
    xxx: {
      url: `${remote}/api/xxx`,
      method: 'get',
      when() {
        return Promise.reject(new Error('reject'))
      }
    }
  }))
})

test('use before function to change the request options', async t => {
  t.plan(2)

  await proxy({
    xxx:{
      url: `${remote}/api/xxx`,
      method: 'get',
      before() {
        return { method: 'post' }
      }
    }
  }).then(result => t.deepEqual(result, { xxx: '[POST]xxx' }))

  await proxy({
    xxx:{
      url: `${remote}/api/xxx`,
      method: 'get',
      before(context, defaults) {
        return [defaults, defaults]
      }
    }
  }).then(result => t.deepEqual(result, { xxx: ['[GET]xxx', '[GET]xxx'] }))
})

test('use after function to change the result', async t => {
  t.plan(1)

  await proxy({
    xxx:{
      url: `${remote}/api/xxx`,
      method: 'get',
      after(context, defaults) {
        return defaults.replace(/x/g, 'y')
      }
    }
  }).then(result => t.deepEqual(result, { xxx: '[GET]yyy' }))
})

test('use fake function to custom a request completely', async t => {
  t.plan(1)

  await proxy({
    xxx:{
      url: `${remote}/api/xxx`,
      method: 'get',
      fake() {
        return '[FAKE]fff'
      }
    }
  }).then(result => t.deepEqual(result, { xxx: '[FAKE]fff' }))
})

test('use fallback function to output defaults when a request broken', async t => {
  t.plan(1)

  await proxy({
    xxx:{
      url: `${remote}/error_api/xxx`,
      method: 'get',
      fallback() {
        return '[FALLBACK]fff'
      }
    }
  }).then(result => t.deepEqual(result, { xxx: '[FALLBACK]fff' }))
})

test('merge multiple undependent request', async t => {
  t.plan(1)

  await proxy({
    x1:{
      url: `${remote}/api/x1`,
      method: 'get',
    },
    x2:{
      url: `${remote}/api/x2`,
      method: 'get',
    }
  }).then(result => t.deepEqual(result, { x1: '[GET]x1', x2: '[GET]x2' }))
})

test('merge multiple dependent request', async t => {
  t.plan(2)

  await proxy({
    x1:{
      url: `${remote}/api/x1`,
      method: 'get',
    },
    x2:{
      url: `${remote}/api/x2`,
      method: 'get',
      when(context) {
        return !context.x1
      }
    },
    x3:{
      url: `${remote}/api/x3`,
      method: 'get',
      when(context) {
        return context.x1
      }
    }
  }).then(result => t.deepEqual(result, { x1: '[GET]x1', x3: '[GET]x3' }))

  await t.throws(proxy({
    x1:{
      url: `${remote}/api/x1`,
      method: 'get',
      when(context) {
        return context.xxx
      }
    },
  }))
})

test('private key is not contained in the final response', async t => {
  t.plan(1)

  await proxy({
    '#x1':{
      url: `${remote}/api/x1`,
      method: 'get',
    },
    x2:{
      url: `${remote}/api/x2`,
      method: 'get',
      when(context) {
        return context.x1
      }
    }
  }).then(result => t.deepEqual(result, { x2: '[GET]x2' }))
})

test('maxdepends option', async t => {
  t.plan(2)

  await t.throws(proxy({
    x1:{
      url: `${remote}/api/x1`,
      method: 'get',
    },
    x2:{
      url: `${remote}/api/x2`,
      method: 'get',
      when(context) {
        return context.x1
      }
    },
    x3:{
      url: `${remote}/api/x3`,
      method: 'get',
      when(context) {
        return context.x2
      }
    },
  }, { maxdepends: 1 }))

  await t.throws(proxy({
    x1:{
      url: `${remote}/api/x1`,
      method: 'get',
      when(context) {
        return context.x1
      }
    },
  }))

})

test('skipnull option', async t => {
  t.plan(2)

  await proxy({
    xxx: {
      fake: () => null
    }
  }, { skipnull: false }).then(result => {
    t.deepEqual(result, { xxx: null })
  })

  await proxy({
    xxx: {
      fake: () => null
    }
  }).then(result => {
    t.deepEqual(result, {})
  })
})

test('onstat option', async t => {
  t.plan(10)

  await proxy({
    xxx: {
      url: `${remote}/api/xxx`,
      method: 'get',
    }
  }, {
    onstat(requests) {
      t.is(requests.length, 1)
      t.is(requests[0].request.url, `${remote}/api/xxx`)
      t.is(requests[0].response.status.code, 200)
      t.falsy(requests[0].error)
    }
  })

  await t.throws(proxy({
    xxx: {
      url: `${remote}/error_api/xxx`,
      method: 'get',
    }
  }, {
    onstat(requests) {
      t.is(requests.length, 1)
      t.is(requests[0].request.url, `${remote}/error_api/xxx`)
      t.is(requests[0].response.status.code, 404)
      t.true(requests[0].error instanceof Error)
    }
  }))

  await proxy({
    xxx: {
      url: `${remote}/api/xxx`,
      method: 'get',
      before(context, defaults) {
        return [
          defaults, defaults, defaults
        ]
      },
    }
  }, {
    onstat(requests) {
      t.is(requests.length, 3)
    }
  })

})
