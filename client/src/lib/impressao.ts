/** Imprime só o bloco `.so-impressao` (e não a página inteira): o resto da tela some enquanto a classe estiver no body. */
export function imprimirSoFolha() {
  document.body.classList.add("imprimindo-qr");
  const limpar = () => {
    document.body.classList.remove("imprimindo-qr");
    window.removeEventListener("afterprint", limpar);
  };
  window.addEventListener("afterprint", limpar);
  window.print();
  window.setTimeout(limpar, 1000);
}
