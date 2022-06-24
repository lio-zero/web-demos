const fs = require('fs')
const path = require('path')
const traverse = require('@babel/traverse').default
const { transformFromAst } = require('@babel/core')
const parser = require('@babel/parser')

let ID = 0

function createAsset(filename) {
  const content = fs.readFileSync(filename, 'utf-8')
  const ast = parser.parse(content, {
    sourceType: 'module' // 识别 ES 模块
  })

  // 存放模块的相对路径
  const dependencies = []

  traverse(ast, {
    // 获取通过 import 引入的模块
    ImportDeclaration({ node }) {
      // 保存所依赖的模块
      dependencies.push(node.source.value)
    }
  })

  const id = ID++

  const { code } = transformFromAst(ast, null, {
    presets: ['@babel/preset-env']
  })

  return {
    id,
    filename,
    dependencies,
    code
  }
}

function createGraph(entry) {
  const mainAsset = createAsset(entry)

  const queue = [mainAsset]

  for (const asset of queue) {
    // 存放依赖模块和对应的唯一 ID
    asset.mapping = {}
    // 模块所在的目录
    const dirname = path.dirname(asset.filename)
    // 遍历其相关路径的列表，获取它们的依赖关系
    asset.dependencies.forEach((relativePath) => {
      // createAsset 需要一个绝对路径，但该依赖关系保存了一个相对路径的数组，这些路径相对于它们的文件
      // 我们可以通过将相对路径与父资源目录的路径连接，将相对路径转变为绝对路径
      const absolutePath = path.join(dirname, relativePath)
      // 解析资源，读取其内容并提取其依赖关系
      const child = createAsset(absolutePath)
      // 了解 asset 依赖取决于 child 这一点对我们来说很重要
      // 通过给 asset.mapping 对象增加一个新的属性 child.id 来表达这种一一对应的关系
      asset.mapping[relativePath] = child.id
      // 最后，我们将 child 这个资源推入 queue，这样它的依赖关系也将被迭代和解析
      queue.push(child)
    })
  }

  return queue
}

function bundle(graph) {
  let modules = ''

  graph.forEach((mod) => {
    modules += `${mod.id}: [
      function (require, module, exports) { ${mod.code} },
      ${JSON.stringify(mod.mapping)},
    ],`
  })

  const result = `
    (function(modules) {
      function require(id) {
        const [fn, mapping] = modules[id];
        function localRequire(name) {
          return require(mapping[name]);
        }
        const module = { exports : {} };
        fn(localRequire, module, module.exports);
        return module.exports;
      }
      require(0);
    })({${modules}})
    `
  // 返回最终结果
  return result
}

const graph = createGraph('./src/index.js')
const result = bundle(graph)

if (!fs.existsSync('./dist')) {
  console.log(123)
  fs.mkdir(`${process.cwd()}/dist`, (err) => {
    if (err) throw err

    console.log('已成功创建文件夹!')
  })
}

fs.writeFile('./dist/main.js', result, (err) => {
  if (err) throw err
  process.stdout.write('创建成功！')
})
