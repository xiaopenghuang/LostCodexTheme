import { generate, ident, parse, walk, type Value } from 'css-tree';

const variables: Record<string, string> = {
  '--ds-theme-color-background': '--lct-background-color', '--ds-theme-color-panel': '--lct-panel-color',
  '--ds-theme-color-panel-alt': '--lct-composer-color', '--ds-theme-color-accent': '--lct-accent',
  '--ds-theme-color-text': '--lct-text-color', '--ds-theme-color-line': '--lct-border-color',
  '--ds-theme-font-family': '--lct-ui-font', '--ds-theme-font-scale': '--lct-font-scale',
  '--ds-theme-surface-opacity': '--lct-surface-opacity', '--ds-theme-surface-blur': '--lct-surface-blur',
  '--ds-theme-surface-radius': '--lct-radius', '--ds-theme-surface-border-alpha': '--lct-import-border-alpha',
  '--ds-theme-surface-shadow': '--lct-import-shadow', '--ds-theme-image-focus-x': '--lct-image-x',
  '--ds-theme-image-focus-y': '--lct-image-y', '--ds-theme-image-zoom': '--lct-import-image-zoom',
  '--ds-theme-image-dim': '--lct-image-dim', '--ds-theme-image-task-intensity': '--lct-import-image-intensity',
  '--ds-theme-density-scale': '--lct-density', '--ds-theme-motion-level': '--lct-import-motion',
  '--ds-theme-color-accent-alt': '--lct-import-accent-alt', '--ds-theme-color-secondary': '--lct-import-secondary',
  '--ds-theme-color-highlight': '--lct-import-highlight', '--ds-theme-color-muted': '--lct-import-muted',
};

export function importCss(css: string, imageName: string): { css: string; notes: string[] } {
  const notes = new Set<string>();
  function resource(value: string) {
    if (value === imageName || value === `./${imageName}`) {
      return (parse('var(--lct-background-image)', { context: 'value' }) as Value).children.first!;
    }
    if (!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)) throw new Error('第三方样式引用了主题包之外的资源');
    return { type: 'Url' as const, value };
  }
  const tree = parse(css, { parseCustomProperty: true, onParseError: () => { throw new Error('Dream Skin 样式无法解析'); } });
  walk(tree, node => {
    if (node.type === 'Atrule' && ['import', 'font-face'].includes(ident.decode(node.name).toLowerCase())) throw new Error('第三方样式不能加载外部样式或字体');
    if (node.type === 'Function') {
      const name = ident.decode(node.name).toLowerCase();
      if (['image-set', '-webkit-image-set', 'image', 'src', 'expression'].includes(name)) throw new Error('第三方样式包含不支持的资源或执行表达式');
      // Escaped url names are parsed as functions rather than Url nodes.
      if (name === 'url') {
        const value = node.children.first;
        if (node.children.size !== 1 || value?.type !== 'String') throw new Error('第三方样式中的图片引用格式不受支持');
        Object.assign(node, resource(value.value));
      }
    }
    if (node.type === 'Url') {
      Object.assign(node, resource(node.value));
    }
    if (node.type === 'AttributeSelector' && node.name.name === 'data-ds-part') {
      if (node.value?.type !== 'String' || node.matcher !== '=') { notes.add('部分复杂区域选择器需要在高级模式中微调'); return; }
      const part = node.value.value;
      node.name.name = 'data-lct-part';
      if (part === 'message') { node.matcher = '$='; node.value.value = '-message'; }
      if (part === 'home-hero' || part === 'project-list') notes.add('首页装饰与项目列表样式已保留，但当前版本没有对应的独立区域');
    }
    if (node.type === 'Identifier' && variables[node.name]) node.name = variables[node.name];
    if (node.type === 'Declaration') {
      if (variables[node.property]) node.property = variables[node.property];
      node.important = true;
    }
  });
  return { css: generate(tree), notes: [...notes] };
}
