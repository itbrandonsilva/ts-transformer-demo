let foo = 10 / 6;
let bar = Math.sin(Math.cos(foo));
let baz = Math.tan(bar) + 12;

(window as any).foo = foo;
(window as any).bar = bar;
(window as any).baz = baz;