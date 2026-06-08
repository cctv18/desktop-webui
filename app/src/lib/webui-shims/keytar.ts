const store = new Map<string, string>()

function key(service: string, account: string) {
  return `${service}\0${account}`
}

export async function setPassword(
  service: string,
  account: string,
  password: string
) {
  store.set(key(service, account), password)
}

export async function getPassword(service: string, account: string) {
  return store.get(key(service, account)) ?? null
}

export async function deletePassword(service: string, account: string) {
  return store.delete(key(service, account))
}
