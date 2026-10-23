/** Same wire format as supabase-js uploadToSignedUrl: PUT multipart straight to Storage. Browser only. */
export function putToSignedUrl(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.timeout = 30 * 60 * 1000;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("The storage service refused the file. Try again.")));
    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    xhr.ontimeout = () => reject(new Error("The upload took too long."));
    xhr.send(body);
  });
}
