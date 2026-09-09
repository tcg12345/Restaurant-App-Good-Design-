/** Local visual demo: these likes never leave this browser. */
let liked=false;
export const useAuth=()=>({user:{id:'preview'}});
export const useSignInModal=()=>({requireSignIn:()=>{}});
export const useToast=()=>({showToast:()=>{}});
export const getPhotoLikes=async()=>({count:liked?25:24,liked});
export const setPhotoLiked=async(_photo:string,_user:string,value:boolean)=>{liked=value;};
