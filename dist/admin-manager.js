/* Administrator settings. Passwords are sent only to the authenticated server. */
(function(global){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  class LeinzAdminManager {
    constructor({root,storage,getCatalogs,onCatalogs,onNotify=()=>{}}){
      Object.assign(this,{root,storage,getCatalogs,onCatalogs,onNotify});
      this.tab='indices';this.users=[];this.busy=false;this.dirty=false;this.editing=null;this.loadSerial=0;
      root.addEventListener('input',()=>{this.dirty=true;});
      root.addEventListener('submit',event=>{event.preventDefault();if(!this.busy)this.submit(event.target);});
      root.addEventListener('click',event=>{
        const button=event.target.closest('[data-admin-action]');if(!button||this.busy)return;
        const action=button.dataset.adminAction;
        if(action==='remove-index')this.removeIndex(button.dataset.index);
        if(action==='reload-users'&&this.confirmLeave())this.loadUsers();
        if(action==='edit-user'&&this.confirmLeave()){this.editing=this.users.find(u=>String(u.id)===button.dataset.id)||null;this.render();this.root.querySelector('[name="username"]')?.focus();}
        if(action==='cancel-user'&&this.confirmLeave()){this.editing=null;this.render();}
      });
    }
    isDirty(){return this.dirty;}
    isBusy(){return this.busy;}
    confirmLeave(){
      if(this.busy)return false;
      if(this.dirty&&!global.confirm('Perubahan pengaturan belum disimpan. Buang perubahan dan lanjutkan?'))return false;
      this.dirty=false;return true;
    }
    show(tab){this.loadSerial++;this.tab=tab;this.editing=null;this.render();if(tab==='users'&&this.storage.mode==='mysql')this.loadUsers();}
    message(text,error=false){const el=this.root.querySelector('[data-admin-message]');if(el){el.textContent=text;el.hidden=!text;el.className=error?'mm-error':'mm-notice';}}
    setBusy(value){if(value===this.busy)return;this.busy=value;this.root.setAttribute('aria-busy',String(value));if(value){this.disabled=[...this.root.querySelectorAll('button,input,select')].map(el=>[el,el.disabled]);for(const [el]of this.disabled)el.disabled=true;}else{for(const [el,disabled]of this.disabled||[])if(this.root.contains(el))el.disabled=disabled;}}
    render(){
      this.root.classList.add('master-manager');
      this.root.innerHTML='<div class="mm-shell"><h2>'+ (this.tab==='indices'?'Indeks Bahan':'Manage User')+'</h2><p>'+(this.tab==='indices'?'Kelola pilihan indeks pada form produk bahan. Indeks yang dipakai produk harus dipertahankan.':'Administrator dapat membuka Manage. User hanya dapat membuka Studio Lensa.')+'</p><p data-admin-message role="status" hidden></p>'+(this.tab==='indices'?this.indicesHtml():this.usersHtml())+'</div>';
    }
    indicesHtml(){
      const materials=this.getCatalogs().materials,indices=global.LeinzCatalogModel.materialIndices(materials);
      return '<form data-admin-form="index" class="admin-form"><label>Indeks bahan baru<input name="index" type="number" min="1.01" max="2.50" step="0.01" placeholder="Contoh: 1.70" required></label><button class="button primary" type="submit">Tambah indeks</button></form><p class="mm-form-note">Indeks di luar 1.50, 1.56, 1.57, 1.60, 1.67, dan 1.74 tersedia sebagai data katalog. Enam indeks simulasi tetap mengikuti model optik yang tersedia.</p><div class="mm-table-scroll"><table class="mm-table"><thead><tr><th>Indeks</th><th>Produk menggunakan</th><th>Aksi</th></tr></thead><tbody>'+indices.map(index=>{const count=materials.products.filter(p=>p.index===index).length;return '<tr><td>'+esc(index)+'</td><td>'+count+'</td><td><button type="button" class="text-button mm-delete" data-admin-action="remove-index" data-index="'+esc(index)+'" '+(count||indices.length===1?'disabled':'')+'>'+ (count?'Masih digunakan':'Hapus')+'</button></td></tr>';}).join('')+'</tbody></table></div>';
    }
    usersHtml(){
      if(this.storage.mode!=='mysql')return '<p class="mm-form-note">Pengelolaan akun login tersedia pada mode server MySQL. Jalankan aplikasi melalui npm start dan login sebagai administrator.</p>';
      const user=this.editing,own=user?.id===this.storage.user?.id;
      return '<form data-admin-form="user" class="admin-user-form"><h3>'+(user?'Ubah akun '+esc(user.username):'Tambah akun login')+'</h3><div class="mm-form-grid"><label>Username<input name="username" autocomplete="off" minlength="3" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}" value="'+esc(user?.username||'')+'" required></label><label>Password '+(user?'baru (kosongkan untuk mempertahankan)':'')+'<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" '+(user?'':'required')+'></label><label>Level akun<select name="role" '+(own?'disabled':'')+'><option value="user" '+(user?.role!=='administrator'?'selected':'')+'>User</option><option value="administrator" '+(user?.role==='administrator'?'selected':'')+'>Administrator</option></select></label><label class="mm-check"><input name="active" type="checkbox" '+(!user||user.active?'checked':'')+' '+(own?'disabled':'')+'>Akun aktif</label></div><p class="mm-footnote">Username 3–64 karakter. Password minimal 8 karakter. Perubahan password, level, atau penonaktifan akan mengakhiri sesi akun tersebut.</p><div class="mm-section-actions"><button type="submit" class="button primary">'+(user?'Simpan perubahan':'Buat akun')+'</button>'+(user?'<button type="button" class="button secondary" data-admin-action="cancel-user">Batal</button>':'')+'</div></form><div class="mm-section-actions"><h3>Daftar akun</h3><button type="button" class="button secondary" data-admin-action="reload-users">Muat ulang akun</button></div><div class="mm-table-scroll"><table class="mm-table"><thead><tr><th>Username</th><th>Level</th><th>Status</th><th>Aksi</th></tr></thead><tbody>'+this.users.map(u=>'<tr><td>'+esc(u.username)+(u.id===this.storage.user?.id?' (Anda)':'')+'</td><td>'+esc(u.role==='administrator'?'Administrator':'User')+'</td><td>'+(u.active?'Aktif':'Nonaktif')+'</td><td><button type="button" class="text-button" data-admin-action="edit-user" data-id="'+u.id+'">Ubah</button></td></tr>').join('')+'</tbody></table></div>';
    }
    async loadUsers(){
      const serial=++this.loadSerial;this.setBusy(true);this.message('Memuat akun…');
      try{const result=await this.storage.listUsers();if(serial!==this.loadSerial)return;this.users=result.users;this.render();}
      catch(error){if(serial===this.loadSerial)this.message(error.message,true);}
      finally{this.setBusy(false);}
    }
    async saveIndices(indices){
      const next=this.getCatalogs();next.materials.indexOptions=indices.sort((a,b)=>Number(a)-Number(b));
      const checked=global.LeinzCatalogModel.validateCatalogBundle(next);
      if(!checked.ok){this.message(checked.errors.join(' '),true);return;}
      this.setBusy(true);
      try{const saved=await this.storage.saveMaterialIndices(checked.value.materials.indexOptions);this.onCatalogs(saved);this.dirty=false;this.render();this.message('Pilihan indeks bahan tersimpan.');}
      catch(error){this.message(error.message,true);}
      finally{this.setBusy(false);}
    }
    async removeIndex(index){
      const materials=this.getCatalogs().materials;
      if(materials.products.some(p=>p.index===index)){this.message('Indeks masih dipakai produk bahan.',true);return;}
      if(!global.confirm('Hapus pilihan indeks '+index+'?'))return;
      await this.saveIndices(global.LeinzCatalogModel.materialIndices(materials).filter(n=>n!==index));
    }
    async submit(form){
      if(form.dataset.adminForm==='index'){
        const value=Number(form.elements.index.value),index=value.toFixed(2),indices=global.LeinzCatalogModel.materialIndices(this.getCatalogs().materials);
        if(!Number.isFinite(value)||Math.abs(value*100-Math.round(value*100))>1e-8||!global.LeinzCatalogModel.validMaterialIndex(index)){this.message('Isi indeks 1.01–2.50 dengan maksimal dua desimal.',true);return;}
        if(indices.includes(index)){this.message('Indeks '+index+' sudah tersedia.',true);return;}
        await this.saveIndices([...indices,index]);return;
      }
      const value={username:form.elements.username.value.trim(),password:form.elements.password.value,role:form.elements.role.value,active:form.elements.active.checked};
      this.setBusy(true);
      try{
        const edited=this.editing;
        await this.storage.saveUser(edited?.id,value);
        form.elements.password.value='';this.dirty=false;this.editing=null;
        if(edited?.id===this.storage.user?.id){await this.storage.connect();if(!this.storage.authenticated){this.render();this.onNotify('Password diubah. Masuk kembali menggunakan password baru.');return;}}
        await this.loadUsers();this.message('Akun berhasil disimpan.');
      }catch(error){this.message(error.message,true);}
      finally{this.setBusy(false);}
    }
  }
  global.LeinzAdminManager=LeinzAdminManager;
})(typeof window!=='undefined'?window:globalThis);
