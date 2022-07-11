// 可能的状态
const PENDING = 'PENDING'
const FULFILLED = 'FULFILLED'
const REJECTED = 'REJECTED'

class APromise {
  constructor(executor) {
    // 初始化状态
    this.state = PENDING
    // 成功的 value 或拒绝的 reason 在内部映射为 value，最初 promise 没有值
    // 存在 .then 处理程序队列
    this.queue = []

    // 调用立即执行程序
    doResolve(this, executor)
  }

  then(onFulfilled, onRejected) {
    // 空的 executor
    const promise = new APromise(() => {})
    // 同时保存 promise
    handle(this, { promise, onFulfilled, onRejected })
    return promise
  }

  catch(onRejected) {
    return this.then(null, onRejected)
  }

  finally(onFinally) {
    return this.then(
      /* onFulfilled */
      (res) => APromise.resolve(onFinally().call(this)).then(() => res),
      /* onRejected */
      (err) =>
        APromise.resolve(onFinally().call(this)).then(() => {
          throw err
        })
    )
  }

  static resolve(value) {
    return new APromise((resolve) => resolve(value))
  }

  static reject(err) {
    return new APromise((resolve, reject) => reject(err))
  }

  static race(promises) {
    const _Promise = this
    if (!Array.isArray(promises)) {
      return _Promise.reject(new TypeError('race() only accepts an array'))
    }
    return new _Promise((resolve, reject) => {
      promises.forEach((p) => {
        _Promise.resolve(p).then(resolve, reject)
      })
    })
  }

  static all(promises) {
    let remaining = promises.length
    // 判断是否为空
    if (remaining === 0) return APromise.resolve([])

    return new APromise((resolve, reject) => {
      promises.reduce((acc, promise, i) => {
        APromise.resolve(promise).then(
          (res) => {
            acc[i] = res
            --remaining || resolve(acc)
          },
          (err) => {
            reject(err)
          }
        )
        return acc
      }, [])
    })
  }

  static any(promises) {
    return new Promise((resolve, reject) => {
      if (promises.length === 0)
        return reject(new AggregateError('All promises were rejected'))
      promises.reduce((acc, cur) => {
        Promise.resolve(cur).then(
          (data) => {
            resolve(data)
          },
          (err) => {
            acc.push(err)
            if (acc.length === promises.length)
              reject(new AggregateError('All promises were rejected'))
          }
        )
        return acc
      }, [])
    })
  }

  static allSettled(values) {
    let promises = [].slice.call(values)

    return new APromise((resolve, reject) => {
      let result = [],
        count = 0

      promises.forEach((promise) => {
        APromise.resolve(promise)
          .then((value) => {
            result.push({ status: 'fulfilled', value })
          })
          .catch((err) => {
            result.push({ status: 'rejected', value: err })
          })
          .finally(() => {
            if (++count === promises.length) {
              resolve(result)
            }
          })
      })
    })
  }
}

// 带 value 的 fulfill
function fulfill(promise, value) {
  // https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
  if (value === promise) {
    return reject(
      promise,
      new TypeError('A promise cannot be resolved with itself.')
    )
  }

  if (value && (typeof value === 'object' || typeof value === 'function')) {
    let then
    try {
      then = value.then
    } catch (err) {
      return reject(promise, err)
    }

    // promise
    if (then === promise.then && promise instanceof APromise) {
      promise.state = FULFILLED
      promise.value = value
      return finale(promise)
    }

    // thenable
    if (typeof then === 'function') {
      return doResolve(promise, then.bind(value))
    }
  }

  promise.state = FULFILLED
  promise.value = value

  finale(promise)
}

// 带 reason 的 reject
function reject(promise, reason) {
  promise.state = REJECTED
  promise.value = reason

  finale(promise)
}

// 调用 promise 中存储的所有处理程序
function finale(promise) {
  const length = promise.queue.length
  for (let i = 0; i < length; i += 1) {
    handle(promise, promise.queue[i])
  }
}

// 创建作为 executor 参数的 fulfill/reject  函数
function doResolve(promise, executor) {
  // promise 状态转换后，不能在被更改
  let called = false

  function wrapFulfill(value) {
    if (called) return
    called = true
    fulfill(promise, value)
  }

  function wrapReject(reason) {
    if (called) return
    called = true
    reject(promise, reason)
  }

  try {
    executor(wrapFulfill, wrapReject)
  } catch (err) {
    wrapReject(err)
  }
}

// 检查 promise 的状态：
// - 如果 promise 为 PENDING，将其推入 queue 以供以后使用
// - 如果 promise 还不是 PENDING，则调用处理程序
function handle(promise, handler) {
  // 接受最深处的 promise
  while (promise.state !== REJECTED && promise.value instanceof APromise) {
    promise = promise.value
  }

  if (promise.state === PENDING) {
    // 如果为 PENDING，推入 queue
    promise.queue.push(handler)
  } else {
    // 立即执行
    handleResolved(promise, handler)
  }
}

function handleResolved(promise, handler) {
  setImmediate(() => {
    const cb =
      promise.state === FULFILLED ? handler.onFulfilled : handler.onRejected

    // 如果处理程序不是函数，则立即解析
    if (typeof cb !== 'function') {
      if (promise.state === FULFILLED) {
        fulfill(handler.promise, promise.value)
      } else {
        reject(handler.promise, promise.value)
      }
      return
    }

    // 根据规则执行处理程序和转换
    try {
      const value = cb(promise.value)
      fulfill(handler.promise, value)
    } catch (err) {
      reject(handler.promise, err)
    }
  })
}
