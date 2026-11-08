declare module '@kobalab/majiang-core' {
  // The upstream package is JavaScript. Keep its dynamic internals behind our typed public adapter.
  const Majiang: any;
  export default Majiang;
}
