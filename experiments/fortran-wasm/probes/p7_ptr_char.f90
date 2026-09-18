program p
  type :: t
    character(len=:), allocatable :: name
  end type
  type(t), pointer :: b
  allocate(b)
  b%name = "hello"
  print *, "P7 OK ", b%name
end program
