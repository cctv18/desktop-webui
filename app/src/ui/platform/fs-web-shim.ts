export function createReadStream() {
  throw new Error('File streams are only available on the GitDesk WebUI server')
}

export function readFile() {
  throw new Error('File reads are only available on the GitDesk WebUI server')
}

export function readFileSync() {
  throw new Error('File reads are only available on the GitDesk WebUI server')
}

export function stat() {
  throw new Error('File stats are only available on the GitDesk WebUI server')
}
