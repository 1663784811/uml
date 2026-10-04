import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    name: '',
    token: '',
  }),
  getters: {
    isLogin: (state) => !!state.token,
  },
  actions: {
    setToken(token) {
      this.token = token
    },
  },
})
