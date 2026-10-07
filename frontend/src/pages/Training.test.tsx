import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { Training } from "./Training";
const host=document.createElement("div");document.body.appendChild(host);
afterEach(()=>{act(()=>render(null,host));vi.unstubAllGlobals();});
async function mount(payloads: Record<string,unknown>) {
  vi.stubGlobal("fetch",vi.fn(async(path:string)=>new Response(JSON.stringify(payloads[path]??[]),{status:200})));
  act(()=>render(<Training/>,host)); await act(async()=>{await new Promise(r=>setTimeout(r,20));});
}
it("explains empty training and renders keyboard accessible controls",async()=>{
  await mount({"/api/growth/weekly":{last:null,history:[]},"/api/growth":{level:1,medals:[]}});
  expect(host.textContent).toContain("La primera sesión está por empezar");expect(host.textContent).toContain("No hay borradores pendientes");expect(host.textContent).toContain("El experimento necesita casos");expect(host.querySelector("button")?.textContent).toBe("Entrenar ahora");
});
it("links review labels and requires collection before publishing",async()=>{
  await mount({"/api/growth/weekly":{last:null,history:[]},"/api/growth/drafts?state=pending":[{id:1,ticket_id:9,title:"Acceso",body:"Respuesta humana"}],"/api/collections":[{id:1,name:"Manual",kind:"upload",active:true}],"/api/growth":{level:1}});
  expect(host.querySelector("label[for='draft-body-1']")).not.toBeNull();expect(host.querySelector<HTMLTextAreaElement>("textarea#draft-body-1")?.value).toBe("Respuesta humana");expect(Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Aprobar y publicar")?.disabled).toBe(true);
});
it("shows capped AI status and variant results from server",async()=>{
  await mount({"/api/growth/weekly":{last:{week:"2026-W41",level_before:1,level_after:2,xp_gained:25,topics_registered:1,summary:"Una mejora verificada",ai:{calls:0,status:"cap",message:"Tope de gasto alcanzado"},variants:[{top_k:6,passed:3,total:4}]},history:[]},"/api/growth":{level:2,stage:"cria",xp_into_level:5,xp_for_next:20}});
  expect(host.textContent).toContain("Tope de gasto alcanzado");expect(host.textContent).toContain("Semana 41 · 2026");expect(host.querySelector("table caption")?.textContent).toContain("Pruebas de calidad");expect(host.textContent).toContain("3 / 4");
});
it("shows retry when loading fails",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({detail:"No pude cargar la sesión"}),{status:500})));
  act(()=>render(<Training/>,host)); await act(async()=>{await new Promise(r=>setTimeout(r,20));});expect(host.querySelector("[role=alert]")?.textContent).toContain("Reintentar");
});


