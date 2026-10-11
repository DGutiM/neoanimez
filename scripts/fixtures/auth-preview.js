// Browser fixture: no network requests to Supabase, no real users or passwords.
(() => {
  const scenario=new URL(location.href).searchParams.get('scenario') || 'guest';
  const user={id:'00000000-0000-4000-8000-000000000001',email:'test@example.invalid'};
  let session=['member','lateMember','recovery','confirm'].includes(scenario) ? {user,access_token:'test-only',refresh_token:'test-only'} : null;
  const sourceKey='sb-edygetjrdnbziidcmuww-auth-token';
  if(session && scenario!=='lateMember') localStorage.setItem(sourceKey,JSON.stringify(session)); else localStorage.removeItem(sourceKey);
  const rows={user_anime_status:[],user_anime_ratings:[],user_anime_progress:[]};
  if(scenario==='member') rows.user_anime_status.push({anime_id:1,status:'watching',updated_at:new Date().toISOString()});
  const listeners=[];
  const realFetch=window.fetch.bind(window);
  window.fetch=(url,options)=>String(url?.url || url).includes('supabase.co') ? Promise.reject(Error('Supabase network blocked by test fixture')) : realFetch(url,options);
  const emit=(event)=>listeners.forEach(fn=>fn(event,session));
  const auth={
    getSession:async()=>({data:{session},error:null}),
    refreshSession:async()=>({data:{session},error:null}),
    signInWithPassword:async({email})=>{session={user:{...user,email},access_token:'test-only'};localStorage.setItem(sourceKey,JSON.stringify(session));emit('SIGNED_IN');return{data:{session,user:session.user},error:null};},
    signUp:async()=>({data:{user,session:null},error:null}),
    signOut:async()=>{session=null;localStorage.removeItem(sourceKey);emit('SIGNED_OUT');return{error:null};},
    resetPasswordForEmail:async()=>({data:{},error:null}),
    setSession:async()=>({data:{session},error:null}),
    exchangeCodeForSession:async()=>({data:{session},error:null}),
    startAutoRefresh(){},stopAutoRefresh(){},
    onAuthStateChange(fn){listeners.push(fn);setTimeout(()=>fn(scenario==='recovery'?'PASSWORD_RECOVERY':'INITIAL_SESSION',session),0);return{data:{subscription:{unsubscribe(){}}}};}
  };
  function from(table){
    let single=false;
    const query=new Proxy({}, {get(_,key){
      if(key==='then') return (resolve,reject)=>Promise.resolve({data:single?null:(rows[table] || []),error:null}).then(resolve,reject);
      if(key==='upsert') return value=>{const list=rows[table] || (rows[table]=[]);const i=list.findIndex(x=>x.anime_id===value.anime_id);if(i<0)list.push(value);else list[i]=value;return query;};
      if(key==='maybeSingle'||key==='single') return ()=>{single=true;return query;};
      return ()=>query;
    }});
    return query;
  }
  window.supabase={createClient:()=>({auth,from,rpc:async name=>({data:name==='get_my_anime_data'?{statuses:rows.user_anime_status,ratings:rows.user_anime_ratings,progress:rows.user_anime_progress}:name==='get_my_community_role'?null:[],error:null})})};
})();
