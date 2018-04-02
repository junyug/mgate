const test = require('ava')
const sinon = require('sinon')
const Busboy = require('busboy')
const createServer = require('http').createServer
const http = require('../lib/http')

const httpro = function (options, callback) {
  return new Promise((resolve, reject) => {
    http(options, (err, result) => {
      callback && callback(err, result)
      resolve()
    })
  })
}

let server

test.beforeEach(async t => {
  server = createServer((req, res) => {
    server.emit(req.url.replace(/(\?.*)/, ''), req, res)
  })

  await new Promise((resolve, reject) => {
    server.listen(0, 'localhost', (err) => {
      if (err) {
        reject(err)
      }
      else {
        server.url = `http://localhost:${server.address().port}`
        resolve()
      }
    })
  })
})

test.afterEach.always(t => {
  server.close()
})

test.serial('callback', async t => {
  t.plan(4)

  server.on('/api/1', (req, res) => {
    res.end('ok')
  })

  server.on('/api/2', (req, res) => {
    res.writeHead(404)
    res.end('ok')
  })

  await httpro({
    url: `${server.url}/api/1`
  }, (err, result) => {
    t.is(err, null)
    t.is(result, 'ok')
  })

  await httpro({
    url: `${server.url}/api/2`
  }, (err, result) => {
    t.true(err instanceof Error)
    t.is(result, undefined)
  })

})

test.serial('GET is used default', async t => {
  t.plan(1)

  server.on('/api/1', (req, res) => {
    t.is(req.method, 'GET')
    res.end()
  })

  await httpro({
    url: `${server.url}/api/1`,
  })

})

test.serial('POST is used application/x-www-form-urlencoded default', async t => {
  t.plan(2)

  server.on('/api/1', (req, res) => {
    t.is(req.method, 'POST')
    t.is(req.headers['content-type'], 'application/x-www-form-urlencoded')
    res.end()
  })

  await httpro({
    url: `${server.url}/api/1`,
    method: 'post',
    data: {
      foo: 'bar'
    }
  })

})

test.serial('custom headers', async t => {
  t.plan(2)

  server.on('/api/1', (req, res) => {
    t.is(req.headers['content-type'], 'application/json')
    t.is(req.headers['x-requested-with'], 'XMLHttpRequest')
    res.end()
  })

  await httpro({
    url: `${server.url}/api/1`,
    headers: {
      'content-type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    }
  })
})

test.serial('send data', async t => {
  t.plan(3)

  server.on('/api/1', (req, res) => {
    t.is(req.url, '/api/1?foo=bar')
    res.end()
  })

  server.on('/api/2', (req, res) => {
    t.is(req.url, '/api/2')
    req.on('data', chunk => {
      t.is(chunk.toString(), 'foo=bar')
      res.end()
    })
  })

  await httpro({
    url: `${server.url}/api/1`,
    method: 'get',
    data: {
      foo: 'bar'
    }
  })

  await httpro({
    url: `${server.url}/api/2`,
    method: 'post',
    data: {
      foo: 'bar'
    }
  })

})

test.serial('json', async t => {
  t.plan(2)

  server.on('/api/1', (req, res) => {
    t.is(req.url, '/api/1')
    req.on('data', chunk => {
      try {
        chunk = JSON.parse(chunk)
      }
      catch (e) {
        return
      }
      t.deepEqual(chunk, {foo: 'bar'})
      res.end()
    })
  })

  await httpro({
    url: `${server.url}/api/1`,
    method: 'post',
    data: {
      foo: 'bar'
    },
    datatype: 'json'
  })

})

test.serial('formdata', async t => {
  t.plan(2)

  server.on('/api/1', (req, res) => {
    let busboy = new Busboy({ headers: req.headers })
    busboy.on('field', (key, value) => {
      t.is(key, 'foo')
      t.is(value, 'bar')
      res.end()
    })
    req.pipe(busboy)
  })

  await httpro({
    url: `${server.url}/api/1`,
    method: 'post',
    data: {
      foo: 'bar'
    },
    datatype: 'form-data'
  })

})
