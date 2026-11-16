// Small browser helpers shared by the editors: ids, saving text as a file, reading a picked file.

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Lets the browser save some text as a file. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Asks for a file and gives its text. */
export function pickFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) file.text().then(resolve, reject);
    });
    input.click();
  });
}
