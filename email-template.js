const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function brandedEmail(payload){
 const content=escapeHtml(payload.text||'').replace(/https:\/\/[^\s]+/g,url=>'<a href="'+url+'" style="color:#bc4b16;word-break:break-all">'+url+'</a>').replace(/\n/g,'<br>');
 return {...payload,html:'<!doctype html><html><body style="margin:0;background:#f3f4f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff"><tr><td style="padding:28px 28px 32px;font:16px/1.6 Arial,sans-serif;color:#19212c;overflow-wrap:anywhere">'+content+'</td></tr></table></td></tr></table></body></html>'};
}
