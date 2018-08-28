const httpRequest = require('http').request
const httpsRequest = require('https').request
const zlib = require('zlib')
const url = require('url')
const querystring = require('querystring')
const FormData = require('form-data')
const debug = require('debug')('mgate:http')
const circuitbreaker = require('../circuitbreaker')

const rhttp = /^https?:\/\//
const rjson = /^application\/json\b/
const rformdata = /^multipart\/form-data\b/
const rtrimqs = /(?:\?.*)?$/

class HTTPError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.status = status
  }
}

exports.http = function http(options, callback) {

  let urls = url.parse(options.url)
  let timeout = options.timeout
  let datatype = options.datatype ? options.datatype.toLowerCase() : 'urlencoded'
  let headers = {}
  let method = 'get'
  let data, formdata

  callback = (function (callback) {
    return (err, res) => {
      const req = {
        url: options.url,
        method: method,
        headers: headers,
        data: options.data
      }
      if (err) {
        callback(err, null, res, req)
      }
      else {
        callback(null, res.body, res, req)
      }
    }
  })(callback || function () {})

  if (options.headers) {
    for (let key in options.headers) {
      headers[key.toLowerCase()] = options.headers[key]
    }
  }

  if (options.method) {
    method = options.method.toLowerCase()
  }

  if (method === 'get' || method === 'head') {
    let d = querystring.stringify(options.data)
    if (d) {
      urls.path += '?' + d
    }
  }

  if (method === 'post' || method === 'put' || method === 'delete') {
    if (datatype === 'form-data') {
      formdata = new FormData()
      for (let key in options.data) {
        let v = options.data[key]
        if (!v.value) {
          v = {
            value: v
          }
        }
        formdata.append(key, v.value, v.options)
      }
      headers['content-type'] = formdata.getHeaders()['content-type']
      headers['content-length'] = formdata.getLengthSync()
    }
    else {
      if (datatype === 'urlencoded') {
        data = querystring.stringify(options.data)
        headers['content-type'] = 'application/x-www-form-urlencoded'
      }
      else if (datatype === 'json') {
        data = JSON.stringify(options.data)
        headers['content-type'] = 'application/json'
      }
      else if (datatype === 'text') {
        data = options.data
        headers['content-type'] = 'text/plain'
      }
      else if (datatype === 'raw') {
        data = options.data
        headers['content-type'] = 'application/octet-stream'
      }
      else {
        callback(new Error('unvalid datatype: ' + datatype))
        return
      }
      headers['content-length'] = Buffer.byteLength(data)
    }
  }

  let req
  let reqOptions = {
    host: urls.hostname,
    port: urls.port,
    path: urls.path,
    method,
    headers
  }

  debug('http request %O', reqOptions)

  if (urls.protocol === 'https:') {
    req = httpsRequest(reqOptions)
  }
  else {
    req = httpRequest(reqOptions)
  }

  if (options.timeout) {
    req.setTimeout(options.timeout)
    req.on('timeout', function () {
      req.abort()
    })
  }

  req.on('error', callback)

  let timingStart = new Date()
  req.on('response', response => {
    let timingStop = new Date()
    let res = {
      timing: {
        start: timingStart,
        stop: timingStop
      },
      status: {
        code: response.statusCode,
        message: response.statusMessage
      },
      headers: response.headers
    }

    let status = response.statusCode

    if (status >= 200 && status < 300 || status === 304) {
      let done = body => {
        res.body = body.toString()
        if (rjson.test(response.headers['content-type'])) {
          try {
            res.body = JSON.parse(res.body)
          }
          catch (e) {
            callback(new Error('unvalid json'), res)
            return
          }
          callback(null, res)
        }
        else {
          callback(null, res)
        }
      }
      let buffers = []

      response.on('data', chunk => {
        buffers.push(chunk)
      })

      response.on('end', () => {
        let body = Buffer.concat(buffers)
        if (response.headers['content-encoding'] === 'gzip') {
          zlib.gunzip(body, (err, decode) => {
            if (err) {
              res.body = body.toString()
              callback(err, res)
            }
            else {
              done(decode)
            }
          })
        }
        else {
          done(body)
        }
      })
    }
    else {
      callback(new HTTPError(response.statusMessage, status), res)
    }
  })


  if (formdata) {
    formdata.pipe(req)
    formdata.on('end', () => {
      req.end()
    })
  }
  else {
    if (data) {
      req.write(data)
    }
    req.end()
  }

  return req

}

exports.fetch = async function fetch(options) {
  if (!options.url) {
    throw new Error('http url is required')
  }
  if (!options.method) {
    options.method = 'get'
  }

  const url = options.url.replace(rtrimqs, '')
  const method = options.method.toLowerCase()
  const uri = `[${method}]${url}`

  const cbr = new Proxy(circuitbreaker, {
    get(target, name) {
      return options.circuitbreaker ? target[name] : () => {}
    }
  })

  if (cbr.check(uri)) {
    throw new Error(`circuit break for ${method} ${url}`)
  }

  return await new Promise((resolve, reject) => {
    exports.http(options, (err, data, res, req) => {
      if (err) {
        cbr.monitor(uri)
        cbr.record(uri, false)
      }
      else {
        cbr.record(uri, true)
      }
      resolve({ err, data, res, req })
    })
  })
}