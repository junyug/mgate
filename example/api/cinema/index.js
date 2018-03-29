exports.post = {
  rules: [
    {
      url: 'https://etmdb.com/graphql',
      method: 'post',
      datatype: 'json',
      timeout: 1000,
      fallback() {
        return []
      }
    }
  ]
}
