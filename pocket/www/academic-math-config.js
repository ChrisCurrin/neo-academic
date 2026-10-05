window.MathJax = {
  loader: {
    paths: { mathjax: 'mathjax/es5' },
    load: ['input/asciimath']
  },
  tex: {
    packages: { '[+]': ['ams'] },
    maxBuffer: 20000
  },
  options: {
    enableMenu: false
  },
  svg: {
    fontCache: 'none'
  },
  startup: {
    input: ['tex', 'asciimath'],
    typeset: false
  }
};
