// Browser fixture: no network requests to Supabase, no real users or passwords.
(() => {
  const scenario=new URL(location.href).searchParams.get('scenario') || 'guest';
  if(['catalogRetry','detailRetry','scheduleRetry','slowCatalog'].includes(scenario)) Object.defineProperty(window,'caches',{value:undefined});
  const user={id:'00000000-0000-4000-8000-000000000001',email:'test@example.invalid'};
  let session=['member','lateMember','recovery','confirm','scheduleRetry'].includes(scenario) ? {user,access_token:'test-only',refresh_token:'test-only'} : null;
  const sourceKey='sb-edygetjrdnbziidcmuww-auth-token';
  if(session && scenario!=='lateMember') localStorage.setItem(sourceKey,JSON.stringify(session)); else localStorage.removeItem(sourceKey);
  const rows={user_anime_status:[],user_anime_ratings:[],user_anime_progress:[]};
  if(['member','scheduleRetry'].includes(scenario)) rows.user_anime_status.push({anime_id:1,status:'watching',updated_at:new Date().toISOString()});
  const listeners=[];
  const realFetch=window.fetch.bind(window);
  let catalogFailures=0,detailFailures=0,scheduleFailures=0;
  window.fetch=async(url,options)=>{
    const path=String(url?.url || url);
    if(path.includes('supabase.co')) throw Error('Supabase network blocked by test fixture');
    if(scenario==='catalogRetry' && /anime-(index|lista)\.json/.test(path) && catalogFailures++<2) return new Response('Temporary test failure',{status:503});
    if(scenario==='detailRetry' && path.includes('anime-details/') && detailFailures++===0) return new Response('Temporary test failure',{status:503});
    if(scenario==='scheduleRetry' && path.includes('anime-schedule.json') && scheduleFailures++===0) return new Response('Temporary test failure',{status:503});
    if(scenario==='slowCatalog' && /anime-(index|lista)\.json/.test(path)) await new Promise(resolve=>setTimeout(resolve,5000));
    return realFetch(url,options);
  };
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
    let deleting=false;
    const filters=[];
    const query=new Proxy({}, {get(_,key){
      if(key==='then') return (resolve,reject)=>{
        if(deleting) rows[table]=(rows[table] || []).filter(row=>!filters.every(([field,value])=>row[field]===value));
        return Promise.resolve({data:single?null:(rows[table] || []),error:null}).then(resolve,reject);
      };
      if(key==='delete') return ()=>{deleting=true;return query;};
      if(key==='eq') return (field,value)=>{filters.push([field,value]);return query;};
      if(key==='upsert') return value=>{const list=rows[table] || (rows[table]=[]);const i=list.findIndex(x=>x.anime_id===value.anime_id);if(i<0)list.push(value);else list[i]=value;return query;};
      if(key==='maybeSingle'||key==='single') return ()=>{single=true;return query;};
      return ()=>query;
    }});
    return query;
  }
  window.supabase={createClient:()=>({auth,from,rpc:async name=>({data:name==='get_my_anime_data'?{statuses:rows.user_anime_status,ratings:rows.user_anime_ratings,progress:rows.user_anime_progress}:name==='get_my_community_role'?null:[],error:null})})};
})();
