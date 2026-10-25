// 代码渲染测试
const fib = (n) => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
for (let i = 0; i < 10; i++) {
  console.log(`fib(${i}) = ${fib(i)}`);
}
