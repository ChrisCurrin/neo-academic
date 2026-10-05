// Journal and LaTeX-inspired typographic presets for academic manuscript themes.
// Themes are data-only, validated by the ThemeRegistry. No DOM access.
export const PRESETS = {
  'latex-plain': {
    id: 'latex-plain',
    name: 'LaTeX Plain',
    base: null,
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt: 11, lineHeight: 1.15, leading: '1.0', measure: '65ch' },
    page: { marginTop: '1in', marginBottom: '1in', marginLeft: '1in', marginRight: '1in', columns: 1 },
    headings: { h1:{size:16,weight:700,spacing:'1.2em'}, h2:{size:14,weight:700,spacing:'1em'}, h3:{size:12,weight:600,spacing:'0.8em'} },
    captions: { figure:{fontSize:9,weight:400,align:'center'}, table:{fontSize:9,weight:400,align:'center'} },
    math: { displaySpacing:'1.2em', inlineSpacing:'0.1em' },
    exportOverrides: { latex:{documentclass:'article',packages:['amsmath'],spacing:'single'} }
  },
  'latex-double': {
    id: 'latex-double',
    name: 'LaTeX Double Space',
    base: 'latex-plain',
    typography: { fontSizePt:12, lineHeight:2.0, leading:'2.0' },
    page: { marginTop: '1in', marginBottom: '1in', marginLeft: '1in', marginRight: '1in', columns: 1 },
    headings: { h1:{size:16,weight:700,spacing:'1.2em'}, h2:{size:14,weight:700,spacing:'1em'}, h3:{size:12,weight:600,spacing:'0.8em'} },
    captions: { figure:{fontSize:9,weight:400,align:'center'}, table:{fontSize:9,weight:400,align:'center'} },
    math: { displaySpacing:'1.2em', inlineSpacing:'0.1em' },
    exportOverrides: { latex:{documentclass:'article',packages:['amsmath'],spacing:'double'} }
  },
  'nature': {
    id: 'nature',
    name: 'Nature',
    base: null,
    typography: { fontFamily: 'Helvetica, Arial, sans-serif', fontSizePt:7, lineHeight:1.1, leading:'1.0', measure:'48ch' },
    page: { marginTop:'0.75in', marginBottom:'0.75in', marginLeft:'0.75in', marginRight:'0.75in', columns:1 },
    headings: { h1:{size:9,weight:700,spacing:'0.6em'}, h2:{size:8,weight:700,spacing:'0.5em'}, h3:{size:7,weight:600,spacing:'0.4em'} },
    captions: { figure:{fontSize:6,weight:400,align:'center'}, table:{fontSize:6,weight:400,align:'center'} },
    math: { displaySpacing:'0.8em', inlineSpacing:'0.05em' }
  },
  'nature-communications': {
    id: 'nature-communications',
    name: 'Nature Communications',
    base: 'nature',
    typography: { fontFamily: 'Arial, Helvetica, sans-serif', fontSizePt:8, lineHeight:1.15, measure:'45ch' },
    page: { marginTop:'0.75in', marginBottom:'0.75in', marginLeft:'0.75in', marginRight:'0.75in', columns:1 },
    headings: { h1:{size:10,weight:700,spacing:'0.7em'}, h2:{size:9,weight:700,spacing:'0.6em'}, h3:{size:8,weight:600,spacing:'0.5em'} }
  },
  'science': {
    id: 'science',
    name: 'Science',
    base: null,
    typography: { fontFamily: 'Helvetica, Arial, sans-serif', fontSizePt:9, lineHeight:1.2, leading:'1.0', measure:'44ch' },
    page: { marginTop:'0.75in', marginBottom:'0.75in', marginLeft:'0.75in', marginRight:'0.75in', columns:2, columnGap:'0.3in' },
    headings: { h1:{size:10,weight:700,spacing:'0.6em'}, h2:{size:9,weight:700,spacing:'0.5em'}, h3:{size:8,weight:600,spacing:'0.4em'} },
    captions: { figure:{fontSize:8,weight:400,align:'center'}, table:{fontSize:8,weight:400,align:'center'} },
    math: { displaySpacing:'0.9em', inlineSpacing:'0.06em' }
  },
  'cell': {
    id: 'cell',
    name: 'Cell',
    base: 'science',
    typography: { fontFamily: 'Helvetica, Arial, sans-serif', fontSizePt:8, lineHeight:1.15, measure:'42ch' },
    headings: { h1:{size:10,weight:700,spacing:'0.6em'}, h2:{size:9,weight:700,spacing:'0.5em'}, h3:{size:8,weight:600,spacing:'0.4em'} }
  },
  'chicago': {
    id: 'chicago',
    name: 'Chicago Manual',
    base: 'latex-plain',
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:12, lineHeight:2.0, leading:'2.0', measure:'65ch' },
    page: { marginTop:'1in', marginBottom:'1in', marginLeft:'1.25in', marginRight:'1.25in', columns:1 },
    headings: { h1:{size:18,weight:700,spacing:'1.4em'}, h2:{size:14,weight:700,spacing:'1em'}, h3:{size:12,weight:600,spacing:'0.8em'} },
    captions: { figure:{fontSize:9,weight:400,align:'center'}, table:{fontSize:9,weight:400,align:'center'} },
    math: { displaySpacing:'1.2em', inlineSpacing:'0.1em' }
  },
  'ams': {
    id: 'ams',
    name: 'AMS',
    base: 'latex-plain',
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:10, lineHeight:1.3, leading:'1.0', measure:'65ch' },
    page: { marginTop:'1in', marginBottom:'1in', marginLeft:'1in', marginRight:'1in', columns:1 },
    headings: { h1:{size:16,weight:700,spacing:'1.2em'}, h2:{size:14,weight:700,spacing:'1em'}, h3:{size:12,weight:600,spacing:'0.8em'} },
    captions: { figure:{fontSize:9,weight:400,align:'center'}, table:{fontSize:9,weight:400,align:'center'} },
    math: { displaySpacing:'1.4em', inlineSpacing:'0.12em' }
  },
  'lncs': {
    id: 'lncs',
    name: 'LNCS',
    base: null,
    typography: { fontFamily:'Helvetica, Arial, sans-serif', fontSizePt:10, lineHeight:1.2, leading:'1.0', measure:'42ch' },
    page: { marginTop:'0.75in', marginBottom:'0.75in', marginLeft:'0.75in', marginRight:'0.75in', columns:2, columnGap:'0.25in' },
    headings: { h1:{size:12,weight:700,spacing:'0.8em'}, h2:{size:10,weight:700,spacing:'0.6em'}, h3:{size:9,weight:600,spacing:'0.5em'} },
    captions: { figure:{fontSize:8,weight:400,align:'center'}, table:{fontSize:8,weight:400,align:'center'} },
    math: { displaySpacing:'0.9em', inlineSpacing:'0.06em' }
  },
  'ieee': {
    id: 'ieee',
    name: 'IEEE Transactions',
    base: null,
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:10, lineHeight:1.3, leading:'1.0', measure:'40ch' },
    page: { marginTop:'0.75in', marginBottom:'0.75in', marginLeft:'0.75in', marginRight:'0.75in', columns:2, columnGap:'0.2in' },
    headings: { h1:{size:12,weight:700,spacing:'0.8em'}, h2:{size:10,weight:700,spacing:'0.6em'}, h3:{size:9,weight:600,spacing:'0.5em'} },
    captions: { figure:{fontSize:8,weight:400,align:'center'}, table:{fontSize:8,weight:400,align:'center'} },
    math: { displaySpacing:'0.9em', inlineSpacing:'0.06em' }
  },
  'acm': {
    id: 'acm',
    name: 'ACM Conference',
    base: 'ieee',
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:9, lineHeight:1.25, measure:'38ch' },
    page: { marginTop:'0.75in', marginBottom:'0.75in', marginLeft:'0.75in', marginRight:'0.75in', columns:2, columnGap:'0.2in' },
    headings: { h1:{size:11,weight:700,spacing:'0.7em'}, h2:{size:10,weight:700,spacing:'0.6em'}, h3:{size:9,weight:600,spacing:'0.5em'} }
  },
  'elsevier': {
    id: 'elsevier',
    name: 'Elsevier',
    base: null,
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:10, lineHeight:1.4, leading:'1.0', measure:'60ch' },
    page: { marginTop:'1in', marginBottom:'1in', marginLeft:'1in', marginRight:'1in', columns:1 },
    headings: { h1:{size:14,weight:700,spacing:'1em'}, h2:{size:12,weight:700,spacing:'0.8em'}, h3:{size:11,weight:600,spacing:'0.7em'} },
    captions: { figure:{fontSize:9,weight:400,align:'center'}, table:{fontSize:9,weight:400,align:'center'} }
  },
  'springer': {
    id: 'springer',
    name: 'Springer',
    base: 'elsevier',
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:10, lineHeight:1.35, measure:'62ch' },
    headings: { h1:{size:14,weight:700,spacing:'1em'}, h2:{size:12,weight:700,spacing:'0.8em'}, h3:{size:11,weight:600,spacing:'0.7em'} }
  },
  'pnas': {
    id: 'pnas',
    name: 'PNAS',
    base: null,
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:9, lineHeight:1.2, leading:'1.0', measure:'44ch' },
    page: { marginTop:'0.75in', marginBottom:'0.75in', marginLeft:'0.75in', marginRight:'0.75in', columns:2, columnGap:'0.25in' },
    headings: { h1:{size:11,weight:700,spacing:'0.7em'}, h2:{size:10,weight:700,spacing:'0.6em'}, h3:{size:9,weight:600,spacing:'0.5em'} },
    captions: { figure:{fontSize:8,weight:400,align:'center'}, table:{fontSize:8,weight:400,align:'center'} }
  },
  'aps': {
    id: 'aps',
    name: 'APS Physical Review',
    base: 'pnas',
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:9, lineHeight:1.25, measure:'42ch' },
    headings: { h1:{size:11,weight:700,spacing:'0.7em'}, h2:{size:10,weight:700,spacing:'0.6em'}, h3:{size:9,weight:600,spacing:'0.5em'} }
  },
  'plos': {
    id: 'plos',
    name: 'PLOS ONE',
    base: null,
    typography: { fontFamily: 'Arial, Helvetica, sans-serif', fontSizePt:10, lineHeight:1.5, leading:'1.0', measure:'65ch' },
    page: { marginTop:'1in', marginBottom:'1in', marginLeft:'1in', marginRight:'1in', columns:1 },
    headings: { h1:{size:16,weight:700,spacing:'1.2em'}, h2:{size:14,weight:700,spacing:'1em'}, h3:{size:12,weight:600,spacing:'0.8em'} },
    captions: { figure:{fontSize:9,weight:400,align:'center'}, table:{fontSize:9,weight:400,align:'center'} }
  },
  'jama': {
    id: 'jama',
    name: 'JAMA',
    base: null,
    typography: { fontFamily: 'Times New Roman, serif', fontSizePt:9, lineHeight:1.3, leading:'1.0', measure:'46ch' },
    page: { marginTop:'0.75in', marginBottom:'0.75in', marginLeft:'0.75in', marginRight:'0.75in', columns:2, columnGap:'0.2in' },
    headings: { h1:{size:12,weight:700,spacing:'0.8em'}, h2:{size:10,weight:700,spacing:'0.6em'}, h3:{size:9,weight:600,spacing:'0.5em'} },
    captions: { figure:{fontSize:8,weight:400,align:'center'}, table:{fontSize:8,weight:400,align:'center'} }
  }
};
