// 器が立っていることの確認だけ。画面は次の段で。
const res = await fetch("/api/me");
const me = await res.json();
document.getElementById("who").textContent = res.ok
  ? `${me.subject} (${me.organizations.join(", ")}) として見ています —— 開発用の名乗りです`
  : `台帳に名乗れません: ${me.error ?? res.status}`;
