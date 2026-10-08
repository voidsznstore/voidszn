"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { CartDrawer } from "./cart-drawer";

type CartUi = {
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
};

const CartUiContext = createContext<CartUi | null>(null);

export function useCartUi(): CartUi {
  const value = useContext(CartUiContext);
  if (!value) throw new Error("useCartUi must be used inside CartProvider");
  return value;
}

/** Holds whether the cart drawer is open and renders the drawer once for the whole site. */
export function CartProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ isOpen, openCart, closeCart }), [isOpen, openCart, closeCart]);

  return (
    <CartUiContext.Provider value={value}>
      {children}
      <CartDrawer />
    </CartUiContext.Provider>
  );
}
